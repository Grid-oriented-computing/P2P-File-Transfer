const CryptoJS = require('crypto-js');
const { Buffer } = require('buffer');
var crypto = require("crypto");
const filesystem = require('fs');
const download_http = require('http');
const socketFiles = require('socket.io-file');

// ports from arguments
var myArgs = process.argv.slice(2);
var appPort = myArgs[0];                // port for application server
var p2pPort = myArgs[1];                // port for P2P server

// Application Server
const express = require('express');
const app = express();
app.use(express.static(__dirname));         // Serves static files from the current directory
const http = require('http');               // add HTTP module
const server = http.createServer(app);      // create server with HTTP module
const { Server } = require("socket.io");    // add Socket.IO module
const io = new Server(server);

// P2P Server
var serverP2P = require('http').createServer();
var P2Pio = require('socket.io')(serverP2P);
var P2Pserver = require('socket.io-p2p-server').Server;
P2Pio.use(P2Pserver);
serverP2P.listen(p2pPort, () => {
  console.log("Peer connectable on port " + p2pPort);
});

// P2P Client
var P2P = require('socket.io-p2p');
var P2Pclient = require('socket.io-client');
var clientSecrets = new Map();               // to store encryption keys

// Key generation
var key = {
  client: crypto.getDiffieHellman('modp16'),
  server: crypto.getDiffieHellman('modp16')
};
key.client.generateKeys();
key.server.generateKeys();

function encryptFile(file, encryptionKey) {                               // for SYNCHRONOUS file encryption
  var fileData = filesystem.readFileSync("data/" + file);
  var encryptedData = CryptoJS.AES.encrypt(fileData.toString('hex'), encryptionKey);   // AES algorithm for encryption because it's fast

  var encryptedBuffer = Buffer.from(encryptedData.toString(), 'utf-8');
  if (!filesystem.existsSync('./encrypted')) {   // if the 'encrypted' folder does not exist, create it
    filesystem.mkdirSync('./encrypted');
  }
  filesystem.writeFileSync('encrypted/' + file, encryptedBuffer);   // write encrypted file to 'encrypted' folder
  return file;
}

function decryptFile(file, decryptionKey) {                              // for SYNCHRONOUS file decryption
  var fileData = filesystem.readFileSync("download/" + file);
  var decryptedData = CryptoJS.AES.decrypt(fileData.toString("utf-8"), decryptionKey);
  var decryptedBuffer = Buffer.from(decryptedData.toString(CryptoJS.enc.Utf8), 'hex');
  if (!filesystem.existsSync('./received')) {            // if the 'received' folder does not exist, create it
    filesystem.mkdirSync('./received');
  }
  filesystem.writeFileSync('received/' + file, decryptedBuffer); // write decrypted file to 'received' folder
  return file;
}

async function downloadFile(url, filename, decryptionKey, socket) {
  if (!filesystem.existsSync('./download')) {  // if the 'download' folder does not exist, create it
    filesystem.mkdirSync('./download');
  }
  const fileStream = filesystem.createWriteStream("download/" + filename);  // HTTP protocol handles file transfer

  download_http.get(url, (response) => {
    response.pipe(fileStream);
    fileStream.on('finish', () => {
      var downloadedFileName = decryptFile(filename, decryptionKey);

      app.get('/' + downloadedFileName, (req, res) => {
        res.sendFile(__dirname + '/received/' + downloadedFileName);
      });

      var filePackage = {         // create a package with the file name and its link
        filename: downloadedFileName,
        link: "http://localhost:" + appPort + "/" + downloadedFileName
      };

      socket.emit("download-link", filePackage);

      //socket.emit("file-transfer-complete", filePackage); // Notify sender that file has been received
    });
  });
}

// load the path to the HTML file
app.get('/', (req, res) => {
  return res.sendFile(__dirname + '/index.html');
});

// to allow client access to modules
app.get('/socket.io.js', (req, res, next) => {
  return res.sendFile(__dirname + '/node_modules/socket.io-client/dist/socket.io.js');
});

app.get('/socket.io-file-client.js', (req, res, next) => {
  return res.sendFile(__dirname + '/node_modules/socket.io-file-client/socket.io-file-client.js');
});

io.on('connection', function (socket) {

  // File upload handling
  var uploadHandler = new socketFiles(socket, {
    uploadDir: 'data',
    chunkSize: 10240,     // default 1KB
    transmissionDelay: 0,
    overwrite: false
  });

  uploadHandler.on('start', (fileInfo) => {
    console.log('Start uploading');
    console.log(fileInfo);
  });

  uploadHandler.on('stream', (fileInfo) => {
    console.log(`${fileInfo.wrote} / ${fileInfo.size} byte(s)`);
  });

  uploadHandler.on('error', (err) => {
    console.log('Error!', err);
  });

  uploadHandler.on('abort', (fileInfo) => {
    console.log('Aborted: ', fileInfo);
  });

  // P2P Client
  socket.on('client', (port) => {
    var secretKey;

    var P2P_socket = P2Pclient("http://localhost:" + port);
    var P2P_client = new P2P(P2P_socket);

    P2P_client.emit('publicKey', key.client.getPublicKey());

    P2P_client.on('returnPublicKey', (receivedKey) => {
      console.log("Public key received!");
      secretKey = key.client.computeSecret(receivedKey, null, 'hex');
      //console.log(`Client secret: ${secretKey}`);
      socket.emit('message', "Key exchanged");
    });

    P2P_client.emit('message', "joined");
    P2P_client.on('response', (message) => {
      console.log(message);
    });

    uploadHandler.on('complete', (fileInfo) => {
      console.log('Upload complete');
      console.log(fileInfo);

      var encryptedFileName = encryptFile(fileInfo.name, secretKey);
      app.get('/' + encryptedFileName, (req, res) => {
        res.sendFile(__dirname + '/encrypted/' + encryptedFileName);
      });

      console.log(encryptedFileName);
      var filePackage = {
        filename: encryptedFileName,
        link: "http://localhost:" + appPort + "/" + encryptedFileName
      };
      P2P_client.emit("download", filePackage);
    });

    socket.on('disconnect', () => {
      io.emit('message', 'User disconnected!');
      P2P_socket.disconnect();
      P2P_client.disconnect();
    });
  });

  // P2P Server
  P2Pio.on('connection', (P2P_socket) => {
    socket.emit('message', "Peer connected!");
    console.log('Peer connected!');

    P2P_socket.on("message", (message) => {
      socket.emit('message', message);
      P2P_socket.emit('response', 'Connection successful!');
    });

    P2P_socket.on("publicKey", (receivedKey) => {
      var secretKey = key.server.computeSecret(receivedKey, null, 'hex');
      console.log("secret = " + secretKey);
      clientSecrets.set(P2P_socket.id, secretKey);
      P2P_socket.emit("returnPublicKey", key.server.getPublicKey());
    });

    P2P_socket.on("download", (filePackage) => {
      filePackage.socket_id = P2P_socket.id;
      downloadFile(filePackage.link, filePackage.filename, clientSecrets.get(filePackage.socket_id), socket);
    });

    P2P_socket.on('disconnect', () => {
      console.log('Peer disconnected');
      socket.emit('message', 'Peer disconnected');
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
    io.emit('message', 'User disconnected');
  });
});

server.listen(appPort, () => {
  console.log("App running on port " + appPort);
});
