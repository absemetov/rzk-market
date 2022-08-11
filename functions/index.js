const admin = require("firebase-admin");
// const functions = require("firebase-functions");
// init firebase service
admin.initializeApp();
const bot = require("./bot");
const rzkComRu = require("./sites/rzk.com.ru");

exports.rzkComUa = rzkComRu.express;
exports.rzkComRu = rzkComRu.express;
exports.botUa = bot.handle;
exports.botRu = bot.handle;
exports.triggers = require("./triggers");
// // Create and Deploy Your First Cloud Functions
// https://firebase.google.com/docs/functions/write-firebase-functions

// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
