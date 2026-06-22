import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyDO-sk-TamhGxvxEwbI7yVDeOMnBX4I8s8",
    authDomain: "pachislot-analyze.firebaseapp.com",
    projectId: "pachislot-analyze",
    storageBucket: "pachislot-analyze.firebasestorage.app",
    messagingSenderId: "6411750427",
    appId: "1:6411750427:web:71745acffb53efb154bcbe"
  };

const app = initializeApp(firebaseConfig);

const shouldForceLongPolling = () => {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const db = initializeFirestore(app, shouldForceLongPolling() ? {
  experimentalForceLongPolling: true,
} : {});
