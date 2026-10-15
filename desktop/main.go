package main

import (
	_ "embed"
	"log"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/ca-x/lark/desktop/locales"
	"github.com/egoist/mygo"
)

var openLink = mygo.NewEvent[DeepLink]("desktop:open-link")
var trayCommand = mygo.NewEvent[TrayCommand]("desktop:tray-command")

//go:embed resources/tray.png
var trayIcon []byte

type TrayCommand struct {
	Action string `json:"action"`
}

func main() {
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	dataDir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		log.Fatal(err)
	}
	client, err := newDesktopClient(dataDir)
	if err != nil {
		log.Fatal(err)
	}
	defer client.close()
	mygo.BindAs("Desktop", client)
	if err := mygo.Protocol.Handle("larkmedia", http.HandlerFunc(client.serveMedia)); err != nil {
		log.Fatal(err)
	}
	if err := mygo.App.RegisterURLScheme("lark"); err != nil {
		log.Printf("register lark URL scheme: %v", err)
	}
	var windowMu sync.Mutex
	var window *mygo.Window
	var tray *mygo.Tray
	var trayReady atomic.Bool
	var quitting atomic.Bool
	showWindow := func() {
		windowMu.Lock()
		defer windowMu.Unlock()
		if window == nil {
			window = mygo.NewWindow(mygo.WindowOptions{
				Title: locales.AppName(), URL: "/", Width: 1280, Height: 820,
				MinWidth: 900, MinHeight: 600, StateKey: "main", BackgroundColor: "#17191c",
			})
			window.OnClose(func(event *mygo.CloseEvent) {
				if !quitting.Load() && trayReady.Load() && client.closeBehavior() == "tray" {
					event.PreventDefault()
					window.Hide()
				}
			})
			window.OnClosed(func() {
				windowMu.Lock()
				window = nil
				windowMu.Unlock()
			})
		} else {
			window.Show()
			window.Restore()
			window.Focus()
		}
	}
	emitTray := func(action string) {
		windowMu.Lock()
		w := window
		windowMu.Unlock()
		if w != nil {
			_ = trayCommand.Emit(w, TrayCommand{Action: action})
		}
	}
	trayMenu := func() *mygo.Menu {
		return mygo.NewMenu([]*mygo.MenuItem{
			{Label: locales.ShowApp(), Click: func(*mygo.MenuItem, *mygo.Window) { showWindow() }},
			mygo.Separator(),
			{Label: locales.TogglePlayback(), Click: func(*mygo.MenuItem, *mygo.Window) { emitTray("toggle") }},
			{Label: locales.Previous(), Click: func(*mygo.MenuItem, *mygo.Window) { emitTray("previous") }},
			{Label: locales.Next(), Click: func(*mygo.MenuItem, *mygo.Window) { emitTray("next") }},
			mygo.Separator(),
			{Label: locales.QuitApp(), Click: func(*mygo.MenuItem, *mygo.Window) { quitting.Store(true); mygo.App.Quit() }},
		})
	}
	mygo.App.OnOpenURL(func(raw string) {
		link, err := parseDeepLink(raw)
		if err != nil {
			log.Printf("ignored desktop link: %v", err)
			return
		}
		client.queueLink(link)
		windowMu.Lock()
		w := window
		windowMu.Unlock()
		if w != nil {
			_ = openLink.Emit(w, link)
			w.Restore()
			w.Focus()
		}
	})
	mygo.App.OnSecondInstance(func(_ []string, _ string) { showWindow() })
	mygo.App.WhenReady(func() {
		showWindow()
		var err error
		tray, err = mygo.NewTray(mygo.TrayOptions{
			Icon: trayIcon, ToolTip: locales.AppName(), Menu: trayMenu(),
		})
		if err != nil {
			log.Printf("tray unavailable; close will quit: %v", err)
		} else {
			trayReady.Store(true)
		}
	})
	mygo.App.OnLocaleChanged(func(string) {
		windowMu.Lock()
		w := window
		windowMu.Unlock()
		if w != nil {
			w.SetTitle(locales.AppName())
		}
		if tray != nil {
			tray.SetToolTip(locales.AppName())
			tray.SetMenu(trayMenu())
		}
	})
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting.Store(true) })
	mygo.App.OnActivate(func(visible bool) {
		if !visible {
			showWindow()
		}
	})
	mygo.App.OnWindowAllClosed(mygo.App.Quit)
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
