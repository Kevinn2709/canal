// Configuración de tu app web de Firebase.
//
// Dónde sacarla: Firebase -> engrane (Configuración del proyecto) -> General
// -> "Tus apps" -> tu app web -> "Configuración del SDK" -> Config.
//
// Estos valores NO son secretos: solo identifican tu proyecto, y pueden estar
// en un repositorio público. Lo que protege la conversación es el inicio de
// sesión y las reglas de Firestore (archivo firestore.rules).

// ⬇️ BORRA este bloque de ejemplo y pega en su lugar el que te da Firebase
//    (copia solo desde "const firebaseConfig = {" hasta "};").
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCEgJUF_MFu9ADDg8OHxTYWe6VLE9PaP6M",
  authDomain: "canal-bf662.firebaseapp.com",
  projectId: "canal-bf662",
  storageBucket: "canal-bf662.firebasestorage.app",
  messagingSenderId: "468731667100",
  appId: "1:468731667100:web:0a9365ef2d3749180f4359"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// ⬆️ Hasta aquí. No borres la línea de abajo.

export { firebaseConfig };
