var fs = require('fs')
var net = require('net')
var path = require('path')
var url = require('url')

var tempDir = 'temp'
  , RE_KILL = /^halt$/

function onServerListening() {
  var port = this.address().port
  console.log("LISTENING ON", port)
}

function onServerError(err) {
  if (err.code === 'EADDRINUSE') {
    console.warn('Port', this.address().port, 'in use; trying another...')
    this.close()
    this.listen(0).once('listening', onServerListening)
      .once('error', onServerError)
  }
  else {
    console.error(err.message)
    process.exit(1)
  }
}

var server = net.createServer(function(conn) {
  conn.on('error', function(err) {
    console.error("This is what happens when you destroy a client socket",
      "before the server is done sending:", err.message)
    console.error("Note that code for servers like this that doesn't handle",
      "socket errors will be at risk of being crashed.")
  }).on('readable', function() {
    var b, req, matches
    b = conn.read()
     
    if (b === null) return
    req = b.toString()
    if (matches = req.match(/^asset=(.+)/)) {
      var fpath = path.join('test', tempDir, matches[1])
      fs.createReadStream(fpath)
        .once('error', function(err) {
          console.error('While reading file:', err.message)
          conn.end('ERROR: ' + err.message)
        })
        .once('open', function() {
          console.log('test-tcp-server will now pipe data...')
          this.pipe(conn)
        })
    }
    else if (req.match(RE_KILL)) {
      conn.end('Goodbye.')
      server.close()
    }
    else {
      console.log("client wrote something inappropriate:", JSON.stringify(req))
      conn.end('Go away.')
    }
  })
}).listen(0).once('listening', onServerListening)
  .once('error', onServerError)
  .once('close', function() {
    console.log("test-tcp-server 'close' event; trying to exit now...")
    process.exit()
  })

