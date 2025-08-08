/* global __app_id, __firebase_config, __initial_auth_token */ // ESLint: Canvas 환경에서 주입되는 전역 변수임을 알립니다.

import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy, // 클라이언트 측 정렬에 필요할 수 있지만, 지침에 따라 Firestore orderBy는 피합니다.
} from 'firebase/firestore';

// 로컬 개발 환경에서 이 변수들이 정의되지 않을 경우를 대비하여
// Firebase 프로젝트의 실제 구성 정보로 아래 플레이스홀더를 채워주세요.
// (Firebase 콘솔 -> 프로젝트 설정 -> 내 앱 -> 웹 앱 설정에서 찾을 수 있습니다.)
const LOCAL_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCSM9gCKgzH44rdPsTT0vcp_OII-9np5ts", // 여기에 실제 Firebase API 키를 입력하세요
  authDomain: "personal-meal-manager-app.firebaseapp.com", // 여기에 실제 Firebase Auth 도메인을 입력하세요
  projectId: "personal-meal-manager-app", // 여기에 실제 Firebase 프로젝트 ID를 입력하세요
  storageBucket: "personal-meal-manager-app.firebasestorage.app", // 여기에 실제 Firebase Storage 버킷을 입력하세요
  messagingSenderId: "527298891478", // 여기에 실제 Firebase Messaging Sender ID를 입력하세요
  appId: "1:527298891478:web:9b6e52627fcd6fe53a0377", // 여기에 실제 Firebase App ID를 입력하세요
  measurementId: "G-8FB53P9VS4" // 선택 사항: Google Analytics를 사용하는 경우, 없다면 제거하거나 빈 문자열로 둡니다.
};

// Canvas 환경에서 제공되는 전역 변수들이 정의되어 있지 않을 경우 로컬 설정을 사용합니다.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : LOCAL_FIREBASE_CONFIG;
// Canvas에서 __app_id가 주입되지 않으면 LOCAL_FIREBASE_CONFIG의 appId 또는 기본값을 사용합니다.
const appId = typeof __app_id !== 'undefined' ? __app_id : (LOCAL_FIREBASE_CONFIG.appId || 'default-local-app-id');
// Canvas에서 __initial_auth_token이 주입되지 않으면 null을 사용합니다.
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


// 지수 백오프 유틸리티
const exponentialBackoff = async (fn, retries = 5, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 'unavailable' || error.code === 'resource-exhausted') {
        console.warn(`일시적 오류 발생, ${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // 다음 재시도를 위해 지연 시간 두 배로 늘림
      } else {
        throw error; // 일시적 오류가 아니면 다시 throw
      }
    }
  }
  throw new Error('최대 재시도 횟수를 초과했습니다');
};

function App() {
  // Firebase 인스턴스
  const [app, setApp] = useState(null);
  const [auth, setAuth] = useState(null);
  const [db, setDb] = useState(null);

  // 사용자 인증 상태
  const [user, setUser] = useState(null); // Firebase 사용자 객체
  const [userId, setUserId] = useState(null); // Firestore 경로에 사용될 사용자 ID
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState('');

  // 인증 양식 UI 상태
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginView, setIsLoginView] = useState(true); // true는 로그인, false는 회원가입

  // 식단 관리 상태
  const [meals, setMeals] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showMealForm, setShowMealForm] = useState(false);
  const [editingMeal, setEditingMeal] = useState(null); // null은 새로 추가, 객체는 편집

  // 식단 양식 필드
  const [mealType, setMealType] = useState('Breakfast'); // 식사 유형
  const [dishName, setDishName] = useState(''); // 음식 이름
  const [memo, setMemo] = useState(''); // 메모
  const [mealDate, setMealDate] = useState(''); // 입력 필드용 문자열 날짜

  const [loadingMeals, setLoadingMeals] = useState(false); // 식사 로딩 중 여부
  const [mealActionError, setMealActionError] = useState(''); // 식사 작업 오류 메시지
  const [message, setMessage] = useState(''); // 사용자 피드백용 메시지 (alert 대체)

  // Firebase 초기화 및 인증 리스너 설정
  useEffect(() => {
    try {
      // firebaseConfig가 유효한지 확인 (로컬 환경에서 플레이스홀더가 채워졌는지)
      if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
        setAuthError("Firebase 설정이 완료되지 않았습니다. App.js의 LOCAL_FIREBASE_CONFIG를 채워주세요.");
        setLoadingAuth(false);
        return;
      }

      const firebaseApp = initializeApp(firebaseConfig);
      const firebaseAuth = getAuth(firebaseApp);
      const firestoreDb = getFirestore(firebaseApp);

      setApp(firebaseApp);
      setAuth(firebaseAuth);
      setDb(firestoreDb);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setUserId(currentUser.uid);
          setAuthError('');
        } else {
          setUser(null);
          setUserId(null);
          // 토큰이 없고 명시적으로 로그아웃하지 않은 경우 익명 로그인 시도
          if (!initialAuthToken) {
            try {
              await exponentialBackoff(() => signInAnonymously(firebaseAuth));
            } catch (anonError) {
              console.error("익명 로그인 실패:", anonError);
              setAuthError("로그인에 실패했습니다. 다시 시도해주세요.");
            }
          }
        }
        setLoadingAuth(false);
      });

      // 사용자 정의 토큰이 있는 경우 토큰으로 로그인
      if (initialAuthToken) {
        exponentialBackoff(() => signInWithCustomToken(firebaseAuth, initialAuthToken))
          .catch(error => {
            console.error("사용자 정의 토큰으로 로그인 오류:", error);
            setAuthError("인증 오류가 발생했습니다. 다시 시도해주세요.");
          });
      }

      return () => unsubscribe(); // 인증 리스너 정리
    } catch (error) {
      console.error("Firebase 초기화 실패:", error);
      setAuthError("앱 초기화에 실패했습니다. 자세한 내용은 콘솔을 확인해주세요.");
      setLoadingAuth(false);
    }
  }, []);

  // 사용자, db 또는 선택된 날짜가 변경될 때마다 해당 날짜의 식사 가져오기
  useEffect(() => {
    if (!db || !userId) {
      setMeals([]); // 인증되지 않은 경우 식사 목록 지우기
      return;
    }

    setLoadingMeals(true);
    setMealActionError('');

    // 선택된 날짜를 저장된 날짜 문자열(YYYY-MM-DD)과 일치하도록 형식 지정
    const formattedDate = selectedDate.toISOString().split('T')[0];

    // 특정 사용자와 날짜의 식사를 가져오기 위한 쿼리 생성
    // Firestore 보안 규칙은 `userId` 일치를 보장합니다.
    const mealsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/meals`);
    const q = query(
      mealsCollectionRef,
      where('date', '==', formattedDate)
      // orderBy('createdAt', 'asc') // 참고: Firebase orderBy는 where 절과 함께 사용될 경우 인덱스가 필요합니다.
                                   // 단순화를 위해 인덱스 문제를 피하고 클라이언트 측에서 정렬합니다.
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mealsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // 날짜가 문자열인지 확인하고, UI 형식 지정을 위해 타임스탬프를 Date 객체로 변환
        createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date(),
      }));
      // 생성 시간별로 클라이언트 측 정렬
      mealsData.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      setMeals(mealsData);
      setLoadingMeals(false);
    }, (error) => {
      console.error("식사 가져오기 오류:", error);
      setMealActionError("식사를 불러오는 데 실패했습니다. 다시 시도해주세요.");
      setLoadingMeals(false);
    });

    return () => unsubscribe(); // 스냅샷 리스너 정리
  }, [db, userId, selectedDate]);

  // 인증 양식 제출 처리
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLoginView) {
        await exponentialBackoff(() => signInWithEmailAndPassword(auth, email, password));
      } else {
        await exponentialBackoff(() => createUserWithEmailAndPassword(auth, email, password));
      }
      setEmail('');
      setPassword('');
      setMessage(isLoginView ? '성공적으로 로그인했습니다!' : '계정이 생성되고 로그인되었습니다!');
    } catch (error) {
      console.error("인증 오류:", error);
      let errorMessage = "알 수 없는 오류가 발생했습니다.";
      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = '유효하지 않은 이메일 주소입니다.';
          break;
        case 'auth/user-disabled':
          errorMessage = '이 계정은 비활성화되었습니다.';
          break;
        case 'auth/user-not-found':
          errorMessage = '이 이메일로 사용자를 찾을 수 없습니다.';
          break;
        case 'auth/wrong-password':
          errorMessage = '비밀번호가 틀렸습니다.';
          break;
        case 'auth/email-already-in-use':
          errorMessage = '이미 사용 중인 이메일입니다.';
          break;
        case 'auth/weak-password':
          errorMessage = '비밀번호는 6자 이상이어야 합니다.';
          break;
        default:
          errorMessage = error.message;
      }
      setAuthError(errorMessage);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await exponentialBackoff(() => signInWithPopup(auth, provider));
      setMessage('Google로 성공적으로 로그인했습니다!');
    } catch (error) {
      console.error("Google 로그인 오류:", error);
      setAuthError('Google 로그인에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleSignOut = async () => {
    setAuthError('');
    try {
      await exponentialBackoff(() => signOut(auth));
      setMeals([]); // 로그아웃 시 식사 목록 지우기
      setMessage('성공적으로 로그아웃했습니다!');
    } catch (error) {
      console.error("로그아웃 오류:", error);
      setAuthError('로그아웃에 실패했습니다. 다시 시도해주세요.');
    }
  };

  // 식사 양식 제출 처리 (추가/편집)
  const handleSaveMeal = async (e) => {
    e.preventDefault();
    setMealActionError('');
    setMessage('');

    if (!dishName.trim()) {
      setMealActionError('음식 이름은 비워둘 수 없습니다.');
      return;
    }
    if (!mealDate) {
      setMealActionError('날짜를 선택해주세요.');
      return;
    }

    const mealData = {
      date: mealDate, // YYYY-MM-DD 문자열로 저장
      type: mealType,
      dish: dishName.trim(),
      memo: memo.trim(),
      createdAt: serverTimestamp(), // Firestore 타임스탬프
    };

    try {
      if (editingMeal) {
        // 기존 식사 업데이트
        const mealDocRef = doc(db, `artifacts/${appId}/users/${userId}/meals`, editingMeal.id);
        await exponentialBackoff(() => updateDoc(mealDocRef, mealData));
        setMessage('식사가 성공적으로 업데이트되었습니다!');
      } else {
        // 새 식사 추가
        await exponentialBackoff(() => addDoc(collection(db, `artifacts/${appId}/users/${userId}/meals`), mealData));
        setMessage('식사가 성공적으로 추가되었습니다!');
      }
      // 양식 초기화 및 닫기
      resetMealForm();
      setShowMealForm(false);
    } catch (error) {
      console.error("식사 저장 오류:", error);
      setMealActionError(`식사 저장에 실패했습니다: ${error.message}`);
    }
  };

  const handleDeleteMeal = async (mealId) => {
    setMealActionError('');
    setMessage('');
    // window.confirm 대신 간단한 확인 UI를 구현
    const confirmed = window.confirm("이 식사 항목을 삭제하시겠습니까?");
    if (!confirmed) return;

    try {
      const mealDocRef = doc(db, `artifacts/${appId}/users/${userId}/meals`, mealId);
      await exponentialBackoff(() => deleteDoc(mealDocRef));
      setMessage('식사가 성공적으로 삭제되었습니다!');
      // 삭제된 식사가 편집 중이었다면, 편집 상태를 지우기
      if (editingMeal && editingMeal.id === mealId) {
        resetMealForm();
      }
    } catch (error) {
      console.error("식사 삭제 오류:", error);
      setMealActionError(`식사 삭제에 실패했습니다: ${error.message}`);
    }
  };

  const handleEditMeal = (meal) => {
    setEditingMeal(meal);
    setMealType(meal.type);
    setDishName(meal.dish);
    setMemo(meal.memo);
    setMealDate(meal.date); // 날짜 미리 채우기
    setShowMealForm(true);
  };

  const resetMealForm = () => {
    setEditingMeal(null);
    setMealType('Breakfast');
    setDishName('');
    setMemo('');
    setMealDate(selectedDate.toISOString().split('T')[0]); // 현재 선택된 날짜로 기본값 설정
  };

  // 날짜 탐색
  const changeDate = (days) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + days);
    setSelectedDate(newDate);
  };

  // 표시용 날짜 형식 지정 (예: "월요일, 7월 15, 2024")
  const formatDateForDisplay = (date) => {
    return date.toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  // 컴포넌트 마운트 또는 selectedDate가 변경될 때 식사 양식의 기본 날짜 설정
  useEffect(() => {
    setMealDate(selectedDate.toISOString().split('T')[0]);
  }, [selectedDate]);


  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-xl font-semibold text-gray-700">인증 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 font-inter antialiased flex flex-col items-center p-4 sm:p-6">
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* 메시지 및 오류 표시 */}
      {message && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-md mb-4 w-full max-w-lg shadow-sm" role="alert">
          {message}
        </div>
      )}
      {authError && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md mb-4 w-full max-w-lg shadow-sm" role="alert">
          {authError}
        </div>
      )}
      {mealActionError && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md mb-4 w-full max-w-lg shadow-sm" role="alert">
          {mealActionError}
        </div>
      )}

      {/* 인증 상태에 따른 조건부 렌더링 */}
      {!user ? (
        // 인증 양식 (로그인/회원가입)
        <div className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg border border-gray-200">
          <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">
            {isLoginView ? '다시 오신 것을 환영합니다!' : '오늘 가입하세요!'}
          </h2>
          <form onSubmit={handleAuthSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
            >
              {isLoginView ? '로그인' : '회원가입'}
            </button>
          </form>
          <div className="mt-6 text-center">
            <button
              onClick={() => setIsLoginView(!isLoginView)}
              className="text-blue-600 hover:text-blue-800 font-medium transition duration-200"
            >
              {isLoginView ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
            </button>
          </div>
          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-gray-300"></div>
            <span className="flex-shrink mx-4 text-gray-500">또는</span>
            <div className="flex-grow border-t border-gray-300"></div>
          </div>
          <button
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
            aria-label="Google로 로그인"
          >
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7.745 12.569c0-.422-.038-.853-.105-1.282H5.612v2.417h2.003c-.092.518-.396.96-.867 1.353-.47.393-1.018.665-1.637.797v1.947c.974-.087 1.838-.49 2.535-1.168.697-.678 1.206-1.543 1.499-2.584z" fill="#4285F4"></path>
              <path d="M12.002 6.551c1.503 0 2.802.628 3.736 1.57l1.795-1.795C16.324 4.887 14.342 4 12.002 4c-3.525 0-6.52 2.05-7.988 5.035l2.051 1.595C6.918 8.01 9.24 6.551 12.002 6.551z" fill="#34A853"></path>
              <path d="M19.018 12.002c0-.776-.07-1.536-.201-2.279H12v4.558h6.147c-.201 1.054-.738 1.944-1.597 2.664-.859.72-1.894 1.218-3.049 1.458v2.051c2.25-.213 4.148-1.284 5.496-2.924C18.667 14.544 19.018 13.313 19.018 12.002z" fill="#FBBC05"></path>
              <path d="M12.002 19.453c-2.76 0-5.187-1.517-6.495-3.773l-2.051 1.595c1.468 2.985 4.463 5.035 7.988 5.035 2.228 0 4.21-.887 5.688-2.333l-2.051-1.595c-.934.942-2.233 1.57-3.736 1.57z" fill="#EA4335"></path>
            </svg>
            Google로 로그인
          </button>
        </div>
      ) : (
        // 메인 앱 대시보드
        <div className="w-full max-w-4xl bg-white p-8 rounded-xl shadow-lg border border-gray-200 flex flex-col items-center">
          <div className="w-full flex justify-between items-center mb-6">
            <h1 className="text-4xl font-extrabold text-gray-900">식사 트래커</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700 text-sm hidden sm:block">로그인: {user.email || user.uid}</span>
              <button
                onClick={handleSignOut}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
                aria-label="로그아웃"
              >
                로그아웃
              </button>
            </div>
          </div>

          {/* 날짜 탐색 */}
          <div className="flex items-center justify-between w-full max-w-md mb-8 bg-blue-50 p-3 rounded-lg shadow-inner">
            <button
              onClick={() => changeDate(-1)}
              className="p-2 rounded-full bg-blue-200 hover:bg-blue-300 transition duration-200"
              aria-label="이전 날짜"
            >
              <svg className="w-5 h-5 text-blue-800" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <h2 className="text-2xl font-semibold text-blue-800">
              {formatDateForDisplay(selectedDate)}
            </h2>
            <button
              onClick={() => changeDate(1)}
              className="p-2 rounded-full bg-blue-200 hover:bg-blue-300 transition duration-200"
              aria-label="다음 날짜"
            >
              <svg className="w-5 h-5 text-blue-800" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
            </button>
          </div>

          {/* 식사 추가 버튼 */}
          <button
            onClick={() => {
              setShowMealForm(true);
              resetMealForm();
            }}
            className="bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg mb-6 transition duration-300 ease-in-out shadow-lg hover:shadow-xl flex items-center space-x-2"
            aria-label="새 식사 추가"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
            <span>새 식사 추가</span>
          </button>

          {/* 식사 목록 */}
          <div className="w-full">
            <h3 className="text-2xl font-semibold text-gray-800 mb-4 text-center">오늘의 식사</h3>
            {loadingMeals ? (
              <p className="text-gray-600 text-center">식사 로딩 중...</p>
            ) : meals.length === 0 ? (
              <p className="text-gray-600 text-center">이 날짜에 기록된 식사가 없습니다. 하나 추가해보세요!</p>
            ) : (
              <div className="space-y-4">
                {meals.map((meal) => (
                  <div key={meal.id} className="bg-blue-50 p-5 rounded-lg shadow-md border border-blue-200 flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div className="flex-grow">
                      <p className="text-sm text-gray-500 mb-1">{meal.type}</p>
                      <h4 className="text-xl font-bold text-gray-900 mb-1">{meal.dish}</h4>
                      {meal.memo && <p className="text-gray-700 text-sm italic">{meal.memo}</p>}
                    </div>
                    <div className="flex space-x-3 mt-3 sm:mt-0">
                      <button
                        onClick={() => handleEditMeal(meal)}
                        className="bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-4 rounded-lg shadow-sm transition duration-200"
                        aria-label={`${meal.dish} 편집`}
                      >
                        편집
                      </button>
                      <button
                        onClick={() => handleDeleteMeal(meal.id)}
                        className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg shadow-sm transition duration-200"
                        aria-label={`${meal.dish} 삭제`}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 식사 양식 모달 */}
          {showMealForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg relative">
                <button
                  onClick={() => setShowMealForm(false)}
                  className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-2xl"
                  aria-label="식사 양식 닫기"
                >
                  &times;
                </button>
                <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">
                  {editingMeal ? '식사 항목 편집' : '새 식사 추가'}
                </h3>
                <form onSubmit={handleSaveMeal} className="space-y-5">
                  <div>
                    <label htmlFor="mealDate" className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
                    <input
                      type="date"
                      id="mealDate"
                      value={mealDate}
                      onChange={(e) => setMealDate(e.target.value)}
                      required
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      aria-label="식사 날짜"
                    />
                  </div>
                  <div>
                    <label htmlFor="mealType" className="block text-sm font-medium text-gray-700 mb-1">식사 유형</label>
                    <select
                      id="mealType"
                      value={mealType}
                      onChange={(e) => setMealType(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      aria-label="식사 유형"
                    >
                      <option>아침</option>
                      <option>점심</option>
                      <option>저녁</option>
                      <option>간식</option>
                      <option>기타</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="dishName" className="block text-sm font-medium text-gray-700 mb-1">음식 이름</label>
                    <input
                      type="text"
                      id="dishName"
                      value={dishName}
                      onChange={(e) => setDishName(e.target.value)}
                      placeholder="예: 치킨 샐러드"
                      required
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      aria-label="음식 이름"
                    />
                  </div>
                  <div>
                    <label htmlFor="memo" className="block text-sm font-medium text-gray-700 mb-1">메모 (선택 사항)</label>
                    <textarea
                      id="memo"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      rows="3"
                      placeholder="이 식사에 대한 메모..."
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      aria-label="식사 메모"
                    ></textarea>
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md hover:shadow-lg"
                  >
                    {editingMeal ? '식사 업데이트' : '식사 추가'}
                  </button>
                  {editingMeal && (
                    <button
                      type="button"
                      onClick={resetMealForm}
                      className="w-full mt-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-3 px-4 rounded-lg transition duration-300 ease-in-out shadow-md"
                    >
                      편집 취소
                    </button>
                  )}
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
