import { useState, useEffect, useRef } from 'react'
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, onSnapshot, serverTimestamp, query, where, arrayUnion, deleteDoc } from 'firebase/firestore';
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
  const [filterDist, setFilterDist] = useState(Infinity); // 기본 무제한
  const [users, setUsers] = useState([]);
  const [inputText, setInputText] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [error, setError] = useState(null);

  const radarRef = useRef(null); // 레이더 컨테이너의 DOM 요소를 참조하기 위한 ref
  const [radarDimensions, setRadarDimensions] = useState({ width: 0, height: 0 }); // 레이더 컨테이너의 실제 크기
  const lastUpdateLocRef = useRef(null); // 마지막으로 DB에 업데이트한 위치 저장

  // 1. 익명 로그인 및 위치 추적 시작
  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
    }).catch(err => {
      console.error("Auth Error:", err);
      setError("Firebase 인증에 실패했습니다. 설정을 확인하세요.");
    });

    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setMyLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          });
        },
        (err) => {
          console.error("Geo Error:", err);
          setError("위치 권한을 허용해야 앱을 사용할 수 있습니다.");
        },
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setError("이 브라우저는 위치 정보를 지원하지 않습니다.");
    }
  }, []);

  // 2. 내 위치 및 정보 Firestore 업데이트
  useEffect(() => {
    if (!userId || !myLocation) return;

    const userDoc = doc(db, 'users', userId);
    const updateStatus = () => {
      setDoc(userDoc, {
        uid: userId,
        lat: myLocation.lat,
        lon: myLocation.lon,
        lastSeen: serverTimestamp()
      }, { merge: true }).catch(err => {
        // AbortError 또는 네트워크 중단 에러는 콘솔에 출력하지 않고 무시합니다.
        if (err.name !== 'AbortError' && err.code !== 'cancelled') {
          console.error("Firestore Update Error:", err);
        }
      });
    };
    
    // 마지막 업데이트 위치와 현재 위치 비교
    if (!lastUpdateLocRef.current) {
      // 처음 위치를 가져왔을 때 업데이트
      updateStatus();
      lastUpdateLocRef.current = myLocation;
    } else {
      const dist = getDistance(
        lastUpdateLocRef.current.lat, lastUpdateLocRef.current.lon,
        myLocation.lat, myLocation.lon
      );

      if (dist >= 5) { // 5미터 이상 이동 시에만 업데이트
        updateStatus();
        lastUpdateLocRef.current = myLocation;
      }
    }

    // 움직이지 않아도 30초마다 활동 시간 갱신 (하트비트)
    const heartbeat = setInterval(updateStatus, 30000);
    return () => clearInterval(heartbeat);
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

  // 4. 페이지 종료 시 데이터 삭제 (나갔을 때 즉시 사라지게 함)
  useEffect(() => {
    if (!userId) return;

    const userDoc = doc(db, 'users', userId);

    const handleCleanup = () => {
      // async/await를 제거하고 에러를 무시하도록 처리합니다.
      // 브라우저 종료 시 발생하는 AbortError는 앱 로직에 치명적이지 않습니다.
      deleteDoc(userDoc).catch(() => { /* 종료 시 발생하는 중단 에러 무시 */ });
    };

    window.addEventListener('beforeunload', handleCleanup);
    return () => {
      window.removeEventListener('beforeunload', handleCleanup);
    };
  }, [userId]);

  // 레이더 컨테이너의 실제 크기를 측정하고 상태에 저장
  useEffect(() => {
    const updateDimensions = () => {
      if (radarRef.current) {
        setRadarDimensions({ width: radarRef.current.offsetWidth, height: radarRef.current.offsetHeight });
      }
    };
    updateDimensions(); // 초기 마운트 시 한 번 호출
    window.addEventListener('resize', updateDimensions); // 창 크기 변경 시 다시 호출
    return () => window.removeEventListener('resize', updateDimensions); // 클린업
  }, []);

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
    
    // 거리 계산
    const dist = getDistance(myLocation.lat, myLocation.lon, user.lat, user.lon);
    // 1분 이내에 활동한 사용자만 온라인으로 간주 (Firestore Timestamp는 toMillis() 사용)
    const isOnline = user.lastSeen?.toMillis ? (Date.now() - user.lastSeen.toMillis() < 60000) : false;
    
    return (filterDist === Infinity || dist <= filterDist) && isOnline;
  });

  // 나를 포함한 전체 표시 리스트
  const displayUsers = me ? [me, ...nearbyUsers] : nearbyUsers;

  // 메시지가 있는 사용자들을 timestamp 기준으로 정렬하여 최신 메시지가 위에 오도록 z-index 부여
  displayUsers.sort((a, b) => {
    const timeA = a.timestamp?.toMillis() || 0;
    const timeB = b.timestamp?.toMillis() || 0;
    return timeB - timeA; // 최신 메시지가 앞으로 오도록 내림차순 정렬
  });

  // 선택된 사용자 정보 찾기
  const selectedUser = users.find(u => u.id === selectedUserId);

  // 충돌 감지를 위한 마커의 유효 반경 (픽셀 단위)
  const placedMarkerPositions = []; // 현재 렌더링 주기에서 이미 배치된 마커들의 위치를 저장

  return (
    <div className="chat-app">
      <section id="center">
        <header>
          <div className="filter-buttons">
            <button 
              className={filterDist === 300 ? 'active' : ''} 
              onClick={() => setFilterDist(300)}
            >300m</button>
            <button 
              className={filterDist === 500 ? 'active' : ''} 
              onClick={() => setFilterDist(500)}
            >500m</button>
            <button 
              className={filterDist === 1000 ? 'active' : ''} 
              onClick={() => setFilterDist(1000)}
            >1km</button>
            <button 
              className={filterDist === Infinity ? 'active' : ''} 
              onClick={() => setFilterDist(Infinity)}
            >무제한</button>
          </div>
        </header>

        <div className="hero">
          {error ? (
            <div style={{ color: '#ff4d4f', padding: '20px', textAlign: 'center' }}>
              <p>{error}</p>
              <button onClick={() => window.location.reload()} style={{marginTop: '10px', padding: '5px 10px'}}>재시도</button>
            </div>
          ) : !myLocation ? (
            <p className="loading-text">위치 정보를 가져오고 있습니다...</p>
          ) : (
            <div className="radar-container" ref={radarRef}> {/* ref 연결 */}
              <div className="radar-sweep"></div>
              {displayUsers.map((user, index) => {
                const isMe = user.id === userId;
                const dist = getDistance(myLocation.lat, myLocation.lon, user.lat, user.lon);
                const distanceValue = isMe ? "나" : `${Math.round(dist).toLocaleString()}m`;

                // 메시지가 있는 마커는 높은 z-index를, 그 중에서도 최신 메시지가 가장 높게
                const dynamicZIndex = user.message ? (1000 - index) : 5;

                // 충돌 감지를 위한 마커의 유효 반경 (픽셀 단위)
                const userCollisionRadius = 35;
                
                let hash = 0;
                for (let i = 0; i < user.id.length; i++) {
                  hash = user.id.charCodeAt(i) + ((hash << 5) - hash);
                }

                let left, top; // 최종적으로 마커가 배치될 퍼센트 위치

                if (isMe) {
                  left = 50; top = 50; // '나'는 항상 중앙
                  // '나'의 위치를 배치된 마커 목록에 추가
                  placedMarkerPositions.push({
                    id: user.id,
                    pixelX: (radarDimensions.width / 100) * 50,
                    pixelY: (radarDimensions.height / 100) * 50,
                    collisionRadius: userCollisionRadius,
                  });
                } else {
                  // 초기 위치 계산 (거리 및 해시 기반)
                  let initialAngle = (Math.abs(hash) % 360) * (Math.PI / 180);
                // 레이더 원 안쪽에 안전하게 배치하기 위해 최대 반경을 35%로 제한 (아이콘 및 라벨 공간 확보)
                const maxRadius = 35; 
                  const displayMaxDist = filterDist === Infinity ? 2000 : filterDist;
                let initialRadialPercent = 10 + (Math.min(dist, displayMaxDist) / displayMaxDist) * (maxRadius - 10);

                  let currentAngle = initialAngle;
                  let currentRadialPercent = initialRadialPercent;

                  const MAX_COLLISION_ATTEMPTS = 50; // 충돌 회피 시도 횟수 제한
                  let attempts = 0;
                  let collided = true;

                  let currentPixelX, currentPixelY;

                  // 레이더 컨테이너의 크기가 아직 측정되지 않았다면 충돌 감지 건너뛰기
                  if (radarDimensions.width === 0 || radarDimensions.height === 0) {
                    collided = false; // 충돌 감지 없이 초기 위치 사용
                  }

                  // 충돌이 없을 때까지 또는 최대 시도 횟수에 도달할 때까지 위치 조정
                  while (collided && attempts < MAX_COLLISION_ATTEMPTS) {
                    collided = false;
                    // 현재 각도와 반경으로 퍼센트 위치 계산
                    let tempLeftPercent = 50 + currentRadialPercent * Math.cos(currentAngle);
                    let tempTopPercent = 50 + currentRadialPercent * Math.sin(currentAngle);

                    // 퍼센트 위치를 픽셀 위치로 변환 (충돌 감지를 위해)
                    currentPixelX = (radarDimensions.width / 100) * tempLeftPercent;
                    currentPixelY = (radarDimensions.height / 100) * tempTopPercent;

                    // 이미 배치된 마커들과 충돌하는지 확인
                    for (const placed of placedMarkerPositions) {
                      const dx = currentPixelX - placed.pixelX;
                      const dy = currentPixelY - placed.pixelY;
                      const distanceBetweenCenters = Math.sqrt(dx * dx + dy * dy);

                      // 두 마커의 중심 간 거리가 충돌 반경의 합보다 작으면 충돌
                      if (distanceBetweenCenters < (userCollisionRadius + placed.collisionRadius)) {
                        collided = true;
                        // 충돌 감지, 각도를 미세하게 조정하여 다른 위치 시도
                        currentAngle += (15 * (Math.PI / 180)); // 15도 회전

                        // 각도가 2PI(360도)를 넘어가면 다시 0-2PI 범위로 조정
                        if (currentAngle > 2 * Math.PI) currentAngle -= 2 * Math.PI;
                        break; // 새로운 각도로 다시 모든 배치된 마커와 충돌 검사
                      }
                    }
                    attempts++;
                  }

                  // 충돌 회피 후 최종 위치 설정
                  // (최대 시도 횟수에 도달했거나 레이더 크기가 0인 경우 초기 위치 사용)
                  left = 50 + currentRadialPercent * Math.cos(currentAngle);
                  top = 50 + currentRadialPercent * Math.sin(currentAngle);

                  // 최종 픽셀 위치를 배치된 마커 목록에 추가
                  placedMarkerPositions.push({
                    id: user.id,
                    pixelX: (radarDimensions.width / 100) * left,
                    pixelY: (radarDimensions.height / 100) * top,
                    collisionRadius: userCollisionRadius,
                  });
                }

                return (
                  <div 
                    key={user.id} 
                    className={`user-marker ${isMe ? 'is-me' : ''}`} 
                    style={{ left: `${left}%`, top: `${top}%`, zIndex: dynamicZIndex }}
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    {user.message && <div className="chat-bubble">{user.message}</div>}
                    <img src={heroImg} className="user-icon" alt="user" />
                    <span className="user-label">{isMe ? "나" : distanceValue}</span>
                  </div>
                );
              })}
            </div>
          )}
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
    </div>
  )
}

export default App;
