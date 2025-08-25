import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyDO-sk-TamhGxvxEwbI7yVDeOMnBX4I8s8",
    authDomain: "pachislot-analyze.firebaseapp.com",
    projectId: "pachislot-analyze",
    storageBucket: "pachislot-analyze.firebasestorage.app",
    messagingSenderId: "6411750427",
    appId: "1:6411750427:web:71745acffb53efb154bcbe"
  };

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
