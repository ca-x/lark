package plugin

// pluginBootstrapJS is the stable JavaScript surface injected before a plugin
// entry file. It mirrors SongLoft's names and Promise behavior; unsupported
// host operations are rejected by the Go bridge with a stable error code.
const pluginBootstrapJS = `
'use strict';
var songloft = globalThis.songloft || {};
globalThis.songloft = songloft;
if (typeof globalThis.onInit !== 'function') globalThis.onInit = async function() {};
if (typeof globalThis.onDeinit !== 'function') globalThis.onDeinit = async function() {};
if (typeof globalThis.onHTTPRequest !== 'function') globalThis.onHTTPRequest = async function() {
  return {statusCode: 404, headers: {}, body: ''};
};
if (typeof globalThis.onWebSocket !== 'function') globalThis.onWebSocket = async function(_req, socket) { await socket.close(1008, 'not implemented'); };

var __inboundWSRegistry = new Map();
function __inboundWSDataToHex(data) {
  if (typeof data === 'string') return {dataHex: __go_buffer_from(data, 'utf8'), isBinary: false};
  if (data instanceof Uint8Array) {
    var hex = '';
    for (var i = 0; i < data.length; i++) hex += ('0' + data[i].toString(16)).slice(-2);
    return {dataHex: hex, isBinary: true};
  }
  if (data instanceof ArrayBuffer) return __inboundWSDataToHex(new Uint8Array(data));
  if (data && typeof data._hex === 'string') return {dataHex: data._hex, isBinary: true};
  return {dataHex: __go_buffer_from(String(data), 'utf8'), isBinary: false};
}
function __createInboundWebSocket(connId) {
  var socket = {
    id: connId, readyState: 1, CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
    onmessage: null, onclose: null, onerror: null,
    _listeners: {message: [], close: [], error: []},
    send: function(data) {
      if (this.readyState !== 1) throw new Error('WebSocket is not open');
      var encoded = __inboundWSDataToHex(data);
      return __callBridge('websocket.send', JSON.stringify({connId: this.id, dataHex: encoded.dataHex, isBinary: encoded.isBinary}));
    },
    close: function(code, reason) {
      if (this.readyState >= 2) return Promise.resolve();
      this.readyState = 2;
      return __callBridge('websocket.close', JSON.stringify({connId: this.id, code: code || 1000, reason: reason || ''}));
    },
    onMessage: function(fn) { this.addEventListener('message', fn); },
    onClose: function(fn) { this.addEventListener('close', fn); },
    onError: function(fn) { this.addEventListener('error', fn); },
    addEventListener: function(type, fn) { if (this._listeners[type] && typeof fn === 'function') this._listeners[type].push(fn); },
    removeEventListener: function(type, fn) {
      if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(function(item) { return item !== fn; });
    },
    _emit: async function(type, event) {
      event.type = type; event.target = this;
      var handler = this['on' + type];
      if (typeof handler === 'function') await handler.call(this, event);
      var listeners = this._listeners[type] || [];
      for (var i = 0; i < listeners.length; i++) await listeners[i].call(this, event);
    }
  };
  __inboundWSRegistry.set(connId, socket);
  return socket;
}
async function __handleInboundWebSocketOpen(payload) {
	if (typeof payload === 'string') payload = JSON.parse(payload);
  await onWebSocket(payload.request, __createInboundWebSocket(payload.connId));
}
async function __handleInboundWebSocketMessage(payload) {
	if (typeof payload === 'string') payload = JSON.parse(payload);
  var socket = __inboundWSRegistry.get(payload.connId);
  if (!socket || socket.readyState >= 3) return;
  var value;
  if (payload.isBinary) {
    var hex = payload.dataHex || '';
    value = new Uint8Array(hex.length / 2);
    for (var i = 0; i < value.length; i++) value[i] = parseInt(hex.substr(i * 2, 2), 16);
  } else {
    value = __go_buffer_to_string(payload.dataHex || '', 'utf8');
  }
  await socket._emit('message', {data: value, isBinary: !!payload.isBinary});
}
async function __handleInboundWebSocketClose(payload) {
	if (typeof payload === 'string') payload = JSON.parse(payload);
  var socket = __inboundWSRegistry.get(payload.connId);
  if (!socket) return;
  socket.readyState = 3;
  __inboundWSRegistry.delete(payload.connId);
  await socket._emit('close', {code: payload.code || 1000, reason: payload.reason || '', wasClean: payload.wasClean !== false});
}
function __fireAndForgetHostPromise(name, promise) {
  Promise.resolve(promise).catch(function(error) { console.error(name + ' host event error:', error && error.stack ? error.stack : error); });
}
function __callRegistrationBridge(action) {
  if (typeof globalThis.__go_bridge_sync === 'function') {
    var error = globalThis.__go_bridge_sync(action, '');
    if (error) throw new Error(error);
    return;
  }
  __fireAndForgetHostPromise(action, __callBridge(action, ''));
}

songloft.log = {
  info: function() { console.info.apply(console, arguments); },
  warn: function() { console.warn.apply(console, arguments); },
  error: function() { console.error.apply(console, arguments); },
  debug: function() { console.debug.apply(console, arguments); }
};
songloft.events = {
  onPlayEvent: function(fn) {
    if (typeof fn === 'function') {
      globalThis.onPlayEvent = fn;
      __callRegistrationBridge('plugin.registerPlayEvent');
    }
  },
  offPlayEvent: function() {
    globalThis.onPlayEvent = undefined;
    __callRegistrationBridge('plugin.unregisterPlayEvent');
  }
};
songloft.storage = {
  get: async function(key) { var s = await __callBridge('storage.get', String(key)); return s ? JSON.parse(s) : null; },
  set: async function(key, value) { await __callBridge('storage.set', JSON.stringify({key: String(key), value: value})); },
  delete: async function(key) { await __callBridge('storage.delete', String(key)); },
  keys: async function() { var s = await __callBridge('storage.keys', ''); return s ? JSON.parse(s) : []; }
};
songloft.persistentStorage = {
  get: async function(key) { var s = await __callBridge('persistent-storage.get', String(key)); return s ? JSON.parse(s) : null; },
  set: async function(key, value) { await __callBridge('persistent-storage.set', JSON.stringify({key: String(key), value: value})); },
  delete: async function(key) { await __callBridge('persistent-storage.delete', String(key)); },
  keys: async function() { var s = await __callBridge('persistent-storage.keys', ''); return s ? JSON.parse(s) : []; }
};
songloft.songs = {
  list: async function(options) { var s = await __callBridge('songs.list', JSON.stringify(options || {})); return s ? JSON.parse(s) : []; },
  getById: async function(id) { var s = await __callBridge('songs.getById', JSON.stringify({id: id})); return s ? JSON.parse(s) : null; },
  search: async function(query, options) { var o = Object.assign({query: query}, options || {}); var s = await __callBridge('songs.search', JSON.stringify(o)); return s ? JSON.parse(s) : []; },
  create: async function(songs) { var s = await __callBridge('songs.create', JSON.stringify({songs: songs || []})); return s ? JSON.parse(s) : []; },
  update: async function(id, fields) { var s = await __callBridge('songs.update', JSON.stringify(Object.assign({id: id}, fields || {}))); return s ? JSON.parse(s) : null; },
  delete: async function(id) { await __callBridge('songs.delete', JSON.stringify({id: id})); },
  download: async function(id, options) { var s = await __callBridge('songs.download', JSON.stringify(Object.assign({song_id: id}, options || {}))); return s ? JSON.parse(s) : null; },
  setAutoDownload: async function(options) { await __callBridge('songs.setAutoDownload', JSON.stringify(options || {})); },
  organizePreview: async function(items) { var s = await __callBridge('songs.organizePreview', JSON.stringify({items: items || []})); return s ? JSON.parse(s) : []; },
  organize: async function(items) { var s = await __callBridge('songs.organize', JSON.stringify({items: items || []})); return s ? JSON.parse(s) : []; }
};
songloft.playlists = {
  list: async function() { var s = await __callBridge('playlists.list', ''); return s ? JSON.parse(s) : []; },
  getById: async function(id) { var s = await __callBridge('playlists.getById', JSON.stringify({id: id})); return s ? JSON.parse(s) : null; },
  getSongs: async function(id, options) { var s = await __callBridge('playlists.getSongs', JSON.stringify({id: id, options: options || {}})); return s ? JSON.parse(s) : []; },
  search: async function(query, options) { var o = options || {}; var s = await __callBridge('playlists.search', JSON.stringify({query: query, limit: o.limit || 0, offset: o.offset || 0})); return s ? JSON.parse(s) : []; },
  create: async function(value) { var s = await __callBridge('playlists.create', JSON.stringify(value || {})); return s ? JSON.parse(s) : null; },
  update: async function(id, fields) { var s = await __callBridge('playlists.update', JSON.stringify(Object.assign({id: id}, fields || {}))); return s ? JSON.parse(s) : null; },
  delete: async function(id) { await __callBridge('playlists.delete', JSON.stringify({id: id})); },
  addSongs: async function(id, songIds) { var s = await __callBridge('playlists.addSongs', JSON.stringify({id: id, songIds: songIds || []})); return s ? JSON.parse(s) : {added: 0, skipped: 0}; },
  removeSongs: async function(id, songIds) { await __callBridge('playlists.removeSongs', JSON.stringify({id: id, songIds: songIds || []})); },
  reorder: async function(id, songIds) { await __callBridge('playlists.reorder', JSON.stringify({id: id, songIds: songIds || []})); }
};
songloft.plugin = {
  getToken: async function() { return await __callBridge('plugin.getToken', ''); },
  getHostUrl: async function() { return await __callBridge('plugin.getHostUrl', ''); },
  getFileUrl: async function(filePath) { var s = await __callBridge('plugin.getFileUrl', JSON.stringify({filePath: filePath})); return JSON.parse(s).url; },
  getNetworkAddresses: async function() { var s = await __callBridge('plugin.getNetworkAddresses', ''); return s ? JSON.parse(s) : []; }
};
songloft.lyrics = {
  registerProvider: function() { __callRegistrationBridge('plugin.registerLyricProvider'); },
  unregisterProvider: function() { __callRegistrationBridge('plugin.unregisterLyricProvider'); }
};
songloft.covers = {
  registerProvider: function() { __callRegistrationBridge('plugin.registerCoverProvider'); },
  unregisterProvider: function() { __callRegistrationBridge('plugin.unregisterCoverProvider'); }
};
songloft.comm = {
  _handlers: {},
  send: async function(to, action, payload) { await __callBridge('comm.send', JSON.stringify({to: to, action: action, payload: payload})); },
  call: async function(to, action, payload, timeout) { var s = await __callBridge('comm.call', JSON.stringify({to: to, action: action, payload: payload, timeout: timeout || 10000})); return s ? JSON.parse(s) : null; },
  onMessage: function(action, handler) { if (typeof handler === 'function') this._handlers[action] = handler; }
};
globalThis.__handleInterPluginMessage = async function(serialized) {
  var message = JSON.parse(serialized);
  var handler = songloft.comm._handlers[message.action];
  if (typeof handler !== 'function') {
    return JSON.stringify({success: false, error: 'no handler for action: ' + message.action});
  }
  try {
    var value = await handler(message.payload, message.from);
    return JSON.stringify({success: true, data: value == null ? null : value});
  } catch (error) {
    return JSON.stringify({success: false, error: error && error.message ? error.message : String(error)});
  }
};
songloft.jsenv = {
  create: async function(name, initCode) { var s = await __callBridge('jsenv.create', JSON.stringify({name: name, initCode: initCode || ''})); var p = s ? JSON.parse(s) : {}; if (p.error) throw new Error(p.error); return p.envName; },
  execute: async function(name, code, timeoutMs) { var s = await __callBridge('jsenv.execute', JSON.stringify({name: name, code: code, timeoutMs: timeoutMs || 30000})); return s ? JSON.parse(s) : {result: '', events: []}; },
  executeWait: async function(name, code, timeoutMs, waitEvents) { var s = await __callBridge('jsenv.executeWait', JSON.stringify({name: name, code: code, timeoutMs: timeoutMs || 30000, waitEvents: waitEvents || []})); return s ? JSON.parse(s) : {result: '', events: []}; },
  executeParallel: async function(calls, maxConcurrent) { var s = await __callBridge('jsenv.executeParallel', JSON.stringify({calls: calls || [], maxConcurrent: maxConcurrent || 0})); return s ? JSON.parse(s) : {successIndex: -1, errors: []}; },
  destroy: async function(name) { await __callBridge('jsenv.destroy', JSON.stringify({name: name})); },
  list: async function() { var s = await __callBridge('jsenv.list', ''); return s ? JSON.parse(s) : []; }
};
songloft.command = {
  exec: async function(program, args, options) { var s = await __callBridge('command.exec', JSON.stringify({program: program, args: args || [], timeout: options && options.timeout || 0, stdin: options && options.stdin || '', env: options && options.env || {}})); return s ? JSON.parse(s) : {}; },
  start: async function(name, program, args, options) { var s = await __callBridge('command.start', JSON.stringify({name: name, program: program, args: args || [], env: options && options.env || {}})); return s ? JSON.parse(s) : {}; },
  stop: async function(name) { await __callBridge('command.stop', JSON.stringify({name: name})); },
  isRunning: async function(name) { return (await __callBridge('command.isRunning', JSON.stringify({name: name}))) === 'true'; },
  download: async function(url, filename, options) { await __callBridge('command.download', JSON.stringify({url: url, filename: filename, extract: options && options.extract, extractTarget: options && options.extractTarget})); },
  deleteBin: async function(filename) { await __callBridge('command.deleteBin', filename); },
  listBin: async function() { var s = await __callBridge('command.listBin', ''); return s ? JSON.parse(s) : []; },
  exists: async function(filename) { return (await __callBridge('command.exists', filename)) === 'true'; }
};
songloft.fs = {
  readFile: async function(path, options) { return await __callBridge('fs.readFile', JSON.stringify({path: path, encoding: options && options.encoding || 'utf8'})); },
  writeFile: async function(path, data, options) { await __callBridge('fs.writeFile', JSON.stringify({path: path, data: data, encoding: options && options.encoding || 'utf8'})); },
  appendFile: async function(path, data, options) { await __callBridge('fs.appendFile', JSON.stringify({path: path, data: data, encoding: options && options.encoding || 'utf8'})); },
  readdir: async function(path) { var s = await __callBridge('fs.readdir', JSON.stringify({path: path})); return s ? JSON.parse(s) : []; },
  unlink: async function(path) { await __callBridge('fs.unlink', JSON.stringify({path: path})); },
  exists: async function(path) { return (await __callBridge('fs.exists', JSON.stringify({path: path}))) === 'true'; },
  mkdir: async function(path, options) { await __callBridge('fs.mkdir', JSON.stringify({path: path, recursive: options && options.recursive || false})); },
  stat: async function(path) { var s = await __callBridge('fs.stat', JSON.stringify({path: path})); return JSON.parse(s); },
  rename: async function(oldPath, newPath) { await __callBridge('fs.rename', JSON.stringify({oldPath: oldPath, newPath: newPath})); }
};
songloft.net = {
	_handlers: {},
	_tcpSockets: {},
  udpBind: async function(options) { var s = await __callBridge('net.udpBind', JSON.stringify(options || {})); return s ? JSON.parse(s) : {}; },
  udpSend: async function(socketId, data, addr) { await __callBridge('net.udpSend', JSON.stringify({socketId: socketId, data: btoa(data), addr: addr})); },
  udpJoinMulticast: async function(socketId, group) { await __callBridge('net.udpJoinMulticast', JSON.stringify({socketId: socketId, group: group})); },
  udpLeaveMulticast: async function(socketId, group) { await __callBridge('net.udpLeaveMulticast', JSON.stringify({socketId: socketId, group: group})); },
  udpGetLocalAddr: async function(socketId) { var s = await __callBridge('net.udpGetLocalAddr', JSON.stringify({socketId: socketId})); return s ? JSON.parse(s) : {}; },
  udpClose: async function(socketId) { await __callBridge('net.udpClose', JSON.stringify({socketId: socketId})); delete this._handlers[socketId]; },
  onData: function(socketId, handler) { this._handlers[socketId] = handler; },
  tcpConnect: async function(host, port, options) {
    var s = await __callBridge('net.tcpConnect', JSON.stringify({host: host, port: port, timeout: options && options.timeout || 0}));
    var info = s ? JSON.parse(s) : {};
    var socketId = info.socketId;
    var state = {_dataHandler: null, _closeHandler: null, closed: false};
    this._tcpSockets[socketId] = state;
    return {
      socketId: socketId, localAddr: info.localAddr, remoteAddr: info.remoteAddr,
      send: async function(data) {
        if (state.closed) throw new Error('TCP socket is closed');
        await __callBridge('net.tcpSend', JSON.stringify({socketId: socketId, data: btoa(data)}));
      },
      onData: function(handler) { state._dataHandler = handler; },
      onClose: function(handler) { state._closeHandler = handler; },
      close: async function() {
        if (state.closed) return;
        state.closed = true;
        delete songloft.net._tcpSockets[socketId];
        await __callBridge('net.tcpClose', JSON.stringify({socketId: socketId}));
      }
    };
  }
};
globalThis.__dispatchPlayEvent = async function(serialized) {
  if (typeof globalThis.onPlayEvent === 'function') await globalThis.onPlayEvent(JSON.parse(serialized));
};
globalThis.__dispatchHostEvent = function(type, id, serialized) {
  try {
    if (type === 'play_event') { __fireAndForgetHostPromise(type, globalThis.__dispatchPlayEvent(serialized)); return; }
    if (type === 'net_data') {
      var handler = songloft.net._handlers[id];
      if (typeof handler === 'function') __fireAndForgetHostPromise(type, handler(JSON.parse(serialized)));
      return;
    }
    if (type === 'tcp_data') {
      var tcp = songloft.net._tcpSockets[id];
      if (tcp && typeof tcp._dataHandler === 'function') __fireAndForgetHostPromise(type, tcp._dataHandler(JSON.parse(serialized).data));
      return;
    }
    if (type === 'tcp_close') {
      var closed = songloft.net._tcpSockets[id];
      if (closed) {
        delete songloft.net._tcpSockets[id]; closed.closed = true;
        if (typeof closed._closeHandler === 'function') __fireAndForgetHostPromise(type, closed._closeHandler());
      }
      return;
    }
    if (type === 'inbound_ws_message') { __fireAndForgetHostPromise(type, __handleInboundWebSocketMessage(JSON.parse(serialized))); return; }
    if (type === 'inbound_ws_close') { __fireAndForgetHostPromise(type, __handleInboundWebSocketClose(JSON.parse(serialized))); return; }
    console.warn('unknown host event type: ' + type);
  } catch (error) {
    console.error(type + ' host event dispatch error:', error && error.stack ? error.stack : error);
  }
};
globalThis.__dispatchWSOpen = async function(serialized) { await __handleInboundWebSocketOpen(JSON.parse(serialized)); };
globalThis.__dispatchWSMessage = async function(serialized) { await __handleInboundWebSocketMessage(JSON.parse(serialized)); };
globalThis.__dispatchWSClose = async function(serialized) { await __handleInboundWebSocketClose(JSON.parse(serialized)); };
`
