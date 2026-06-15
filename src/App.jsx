import { useState, useEffect } from 'react'
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, onSnapshot, serverTimestamp, query, where, arrayUnion } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import heroImg from './assets/hero.png'
import './App.css'

// Firebase 설정 (본인의 Firebase 프로젝트 설정값으로 교체 필요)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 두 좌표 사이의 거리를 미터(m) 단위로 계산하는 함수 (Haversine 공식)
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // 지구 반지름 (m)
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

function App() {
  const [userId, setUserId] = useState(null);
  const [myLocation, setMyLocation] = useState(null);
  const [filterDist, setFilterDist] = useState(1000); // 기본 1km
  const [users, setUsers] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);

  // 1. 익명 로그인 및 위치 추적 시작
  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
    });

    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setMyLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          });
        },
        (err) => console.error(err),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // 2. 내 위치 및 정보 Firestore 업데이트
  useEffect(() => {
    if (userId && myLocation) {
      const userDoc = doc(db, 'users', userId);
      setDoc(userDoc, {
        uid: userId,
        lat: myLocation.lat,
        lon: myLocation.lon,
        lastSeen: serverTimestamp()
      }, { merge: true });
    }
  }, [userId, myLocation]);

  // 3. 실시간으로 모든 사용자 데이터 가져오기
  useEffect(() => {
    if (!userId) return;
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userList = [];
      snapshot.forEach((doc) => {
        userList.push({ id: doc.id, ...doc.data() });
      });
      setUsers(userList);
    });
    return () => unsubscribe();
  }, [userId]);

  // 메시지 전송 함수
  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !userId) return;
    
    const userDoc = doc(db, 'users', userId);
    setDoc(userDoc, { 
      message: inputText, 
      history: arrayUnion({ text: inputText, time: new Date().toLocaleTimeString() }),
      timestamp: serverTimestamp() 
    }, { merge: true });
    setInputText('');
  };

  // 내 정보와 다른 사용자 정보를 분리
  const me = users.find(u => u.id === userId);
  const nearbyUsers = users.filter(user => {
    if (!myLocation || user.id === userId) return false;
    const dist = getDistance(myLocation.lat, myLocation.lon, user.lat, user.lon);
    return dist <= filterDist;
  });

  // 선택된 사용자 정보 찾기
  const selectedUser = users.find(u => u.id === selectedUserId);

  return (
    <div className="chat-app">
      <section id="center">
        <header>
          <h1>주변 채팅 ({filterDist}m)</h1>
          <div className="filter-buttons">
            <button onClick={() => setFilterDist(300)}>300m</button>
            <button onClick={() => setFilterDist(500)}>500m</button>
            <button onClick={() => setFilterDist(1000)}>1km</button>
          </div>
        </header>

        <div className="hero">
          <div className="radar-view">
            {myLocation ? (
              <div className="user-marker">
                {me?.message && <div className="chat-bubble" onClick={() => setSelectedUserId(userId)}>{me.message}</div>}
                <div className="marker-label">나 (현재 위치)</div>
                <img src={heroImg} className="user-icon mine" width="60" alt="me" />
              </div>
            ) : (
              <p>위치 정보를 불러오는 중...</p>
            )}
            
            {nearbyUsers.map(user => (
              <div key={user.id} className="user-marker" onClick={() => setSelectedUserId(user.id)}>
                {user.message && <div className="chat-bubble">{user.message}</div>}
            <img src={heroImg} className="user-icon" width="50" alt="user" />
                <span className="user-name">주변 사용자</span>
              </div>
            ))}
          </div>
        </div>

        <form className="chat-input-form" onSubmit={sendMessage}>
          <input 
            type="text" 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            placeholder="주변 사람들에게 한마디..."
          />
          <button type="submit">전송</button>
        </form>

        {selectedUser && (
          <div className="history-panel">
            <div className="history-header">
              <h3>{selectedUser.id === userId ? "나" : "주변 사용자"}의 채팅 기록</h3>
              <button onClick={() => setSelectedUserId(null)}>닫기</button>
            </div>
            <div className="history-content">
              {selectedUser.history?.map((msg, index) => (
                <div key={index} className="history-item">
                  <span className="msg-time">[{msg.time}]</span> {msg.text}
                </div>
              )) || <p>기록이 없습니다.</p>}
            </div>
          </div>
        )}
      </section>

      <section id="user-list">
        <h2>근처 사용자 목록</h2>
        {myLocation ? (
          <ul>
            {nearbyUsers.map(user => (
              <li key={user.id}>
              사용자({user.id.slice(0, 5)}) - {Math.round(getDistance(myLocation.lat, myLocation.lon, user.lat, user.lon))}m
              </li>
            ))}
          </ul>
        ) : (
          <p>내 위치를 공유해야 목록을 볼 수 있습니다.</p>
        )}
      </section>
    </div>
  )
}

export default App
