var key = "networkComputing";
var socket = io();

var input = document.getElementById('input');
var form = document.getElementById('connectionForm');
var messages = document.getElementById('messages');
var uploader = new SocketIOFileClient(socket);

function encrypt(str) {
    return CryptoJS.TripleDES;  //.encrypt(str, key);
}

function addMessage(msg) {
    var item = document.createElement('li');
    var d1 = document.createElement('div');
    d1.innerHTML = msg;
    d1.setAttribute("display", "inline");
    d1.setAttribute("width", "80%");
    item.appendChild(d1);
    messages.appendChild(item);
    var elem = document.getElementById("message-container");  //auto scroll to bottom
    elem.scrollTop = elem.scrollHeight;
};


uploader.on('ready', function () {
    console.log('SocketIOFile ready to go!');
});
uploader.on('loadstart', function () {
    console.log('Loading file to browser before sending...');
});
uploader.on('start', function (fileInfo) {
    console.log('Start uploading', fileInfo);
});
uploader.on('complete', function (fileInfo) {
    console.log('Upload Complete', fileInfo);
});
uploader.on('error', function (err) {
    console.log('Error!', err);
});
uploader.on('abort', function (fileInfo) {
    console.log('Aborted: ', fileInfo);
});


//send on submit
form.addEventListener('click', function (e) {
    e.preventDefault();
    if (input.value) {
        addMessage(`Connected on port ${input.value}`);
        var msg = CryptoJS.TripleDES.encrypt(input.value, key).toString();
        //console.log(`encrypted chat message: ${msg}`);
        socket.emit('client', input.value);             // send connecting port
        input.value = '';
        document.getElementById("input").setAttribute("disabled", "");
    }
});

document.getElementById('submit-file').addEventListener('click', function (e) {
    e.preventDefault();
    var fileUpload = document.getElementById('file');
    var upload = uploader.upload(fileUpload.files);
});

//add message to chat
socket.on('message', msg => {
    console.log(`message ${msg}`);
    addMessage(msg);
});

socket.on('download-link', (file) => {
    addMessage("The file \"" + file.filename + "\" was downloaded to directory 'received'");
});

socket.on('file-transfer-complete', (filePackage) => {
    addMessage(`The file "${filePackage.filename}" was sent successfully.`);
});