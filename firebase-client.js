// firebase-client.js
const { initializeApp } = require('firebase/app');
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');

// Your Firebase web app's configuration object
const firebaseConfig = {
    apiKey: "AIzaSyDgZjaa3iM7vpxwwb2oQYOV9pXqO6VrGbc",
    authDomain: "tourlog-11905.firebaseapp.com",
    projectId: "tourlog-11905",
    storageBucket: "tourlog-11905.appspot.com",
    messagingSenderId: "749186801933",
    appId: "1:749186801933:web:95ce5c721f6a15cbfa1044"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);

// Initialize Firebase Auth
const auth = getAuth(firebaseApp);

module.exports = { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword };
