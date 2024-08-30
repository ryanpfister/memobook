// firebase-admin.js
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://tourlog-11905-default-rtdb.firebaseio.com"
});

const db = admin.firestore();

module.exports = { admin, db };
