globalThis.onInit = async function () {
  songloft.lyrics.registerProvider();
  songloft.covers.registerProvider();
};

globalThis.onDeinit = async function () {
  songloft.lyrics.unregisterProvider();
  songloft.covers.unregisterProvider();
};

globalThis.onHTTPRequest = async function (req) {
  switch (req.path) {
    case "/runtime": {
      const digest = crypto.md5("lark");
      return json({ digest });
    }
    case "/storage":
      await songloft.storage.set("fixture", { ok: true });
      return json(await songloft.storage.get("fixture"));
    case "/persistent-storage":
      await songloft.persistentStorage.set("fixture", { ok: true });
      return json(await songloft.persistentStorage.get("fixture"));
    case "/songs/read":
      return json(await songloft.songs.list({ limit: 1, offset: 0 }));
    case "/songs/write":
      return json(await songloft.songs.create([]));
    case "/playlists/read":
      return json(await songloft.playlists.list());
    case "/playlists/write":
      return json(await songloft.playlists.create({ name: "Fixture" }));
    case "/plugin":
      return json({
        token: await songloft.plugin.getToken(),
        hostUrl: await songloft.plugin.getHostUrl()
      });
    case "/jsenv": {
      const env = await songloft.jsenv.create("fixture", "globalThis.answer = 42");
      const result = await songloft.jsenv.execute(env, "answer");
      await songloft.jsenv.destroy(env);
      return json(result);
    }
    case "/fs":
      await songloft.fs.writeFile("fixture.txt", "ok");
      return text(await songloft.fs.readFile("fixture.txt"));
    case "/command":
      return json(await songloft.command.listBin());
    case "/comm":
      return json(await songloft.comm.call("fixture-peer", "ping", { ok: true }, 1000));
    case "/lyric-search":
      return json({ lyric: "[00:00.00]fixture" });
    case "/cover-search":
      return json({ cover_url: "https://example.com/fixture.png" });
    default:
      return { statusCode: 404, headers: {}, body: "" };
  }
};

globalThis.onWebSocket = async function (_req, socket) {
  socket.onMessage(async function (event) {
    await socket.send(event.data);
  });
};

songloft.comm.onMessage("ping", function (payload) {
  return payload;
});

function json(value) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  };
}

function text(value) {
  return { statusCode: 200, headers: {}, body: String(value) };
}
