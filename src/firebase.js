// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCcC6sf3myl3kflrT1QngB21570JS_5sbQ",
  authDomain: "chess-tournament-app-edd11.firebaseapp.com",
  projectId: "chess-tournament-app-edd11",
  storageBucket: "chess-tournament-app-edd11.firebasestorage.app",
  messagingSenderId: "555417810973",
  appId: "1:555417810973:web:e3de41da714a9bf2a92ef4",
  measurementId: "G-MLE9WY1K40"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);