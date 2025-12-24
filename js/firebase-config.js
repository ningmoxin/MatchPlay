// MatchPlay - Firebase 設定與共用函式

// Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyCrrm45SzhPgLtkqspiXkpWC_rb0Q6MnAM",
  authDomain: "matchplay-8a324.firebaseapp.com",
  databaseURL: "https://matchplay-8a324-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "matchplay-8a324",
  storageBucket: "matchplay-8a324.firebasestorage.app",
  messagingSenderId: "477387192568",
  appId: "1:477387192568:web:5cdd491ee498f7ab03e30d"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// 管理者密碼 (簡單 hash)
const ADMIN_PASSWORD = 'admin2025';

// 資料庫參考
const refs = {
  participants: database.ref('participants'),
  pairs: database.ref('pairs'),
  gameState: database.ref('gameState')
};

// === 工具函式 ===

// 驗證密碼
function verifyPassword(input) {
  return input === ADMIN_PASSWORD;
}

// 顯示 Toast 通知
function showToast(message, duration = 3000) {
  // 移除現有的 toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

// 產生唯一 ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// === 參與者管理 ===

// 取得所有參與者
async function getParticipants() {
  const snapshot = await refs.participants.once('value');
  const data = snapshot.val() || {};
  return Object.entries(data).map(([id, value]) => ({
    id,
    ...value
  })).sort((a, b) => a.order - b.order);
}

// 新增參與者
async function addParticipant(name) {
  const participants = await getParticipants();
  const order = participants.length + 1;
  const id = generateId();

  await refs.participants.child(id).set({
    name: name.trim(),
    order: order
  });

  return id;
}

// 刪除參與者
async function deleteParticipant(id) {
  await refs.participants.child(id).remove();
  // 重新排序
  const participants = await getParticipants();
  const updates = {};
  participants.forEach((p, index) => {
    updates[`${p.id}/order`] = index + 1;
  });
  await refs.participants.update(updates);
}

// 更新參與者名稱
async function updateParticipant(id, name) {
  await refs.participants.child(id).update({ name: name.trim() });
}

// === 遊戲狀態管理 ===

// 取得遊戲狀態
async function getGameState() {
  const snapshot = await refs.gameState.once('value');
  return snapshot.val() || {
    status: 'waiting',
    currentPairIndex: 0,
    lastUpdated: Date.now()
  };
}

// 更新遊戲狀態
async function updateGameState(updates) {
  await refs.gameState.update({
    ...updates,
    lastUpdated: firebase.database.ServerValue.TIMESTAMP
  });
}

// === 配對管理 ===

// 取得所有配對
async function getPairs() {
  const snapshot = await refs.pairs.once('value');
  const data = snapshot.val() || {};
  return Object.entries(data).map(([id, value]) => ({
    id,
    ...value
  })).sort((a, b) => a.revealOrder - b.revealOrder);
}

// 執行隨機配對 (雙向配對，奇數時最後一組為三人)
async function performPairing() {
  const participants = await getParticipants();

  if (participants.length < 2) {
    throw new Error('至少需要 2 位參與者');
  }

  // 清除舊配對
  await refs.pairs.remove();

  // 隨機打亂參與者
  const shuffled = [...participants].sort(() => Math.random() - 0.5);

  // 建立配對
  const pairs = [];
  const isOdd = shuffled.length % 2 !== 0;
  const pairCount = isOdd ? Math.floor(shuffled.length / 2) : shuffled.length / 2;

  // 兩兩配對（如果是奇數，最後三人會組成一組）
  for (let i = 0; i < shuffled.length; ) {
    // 檢查是否為最後三人（奇數情況）
    if (isOdd && shuffled.length - i === 3) {
      // 三人配對
      pairs.push({
        person1: shuffled[i].id,
        person1Name: shuffled[i].name,
        person2: shuffled[i + 1].id,
        person2Name: shuffled[i + 1].name,
        person3: shuffled[i + 2].id,
        person3Name: shuffled[i + 2].name,
        isTriple: true,
        revealed: false,
        revealOrder: 0 // 稍後隨機分配
      });
      i += 3;
    } else {
      // 兩人配對
      pairs.push({
        person1: shuffled[i].id,
        person1Name: shuffled[i].name,
        person2: shuffled[i + 1].id,
        person2Name: shuffled[i + 1].name,
        isTriple: false,
        revealed: false,
        revealOrder: 0 // 稍後隨機分配
      });
      i += 2;
    }
  }

  // 隨機分配揭曉順序
  const randomOrder = pairs.map((_, i) => i + 1).sort(() => Math.random() - 0.5);
  pairs.forEach((pair, index) => {
    pair.revealOrder = randomOrder[index];
  });

  // 儲存配對
  const updates = {};
  pairs.forEach((pair) => {
    updates[generateId()] = pair;
  });
  await refs.pairs.set(updates);

  // 更新遊戲狀態
  await updateGameState({
    status: 'revealing',
    currentPairIndex: 0
  });

  return pairs;
}

// 揭曉下一組配對
async function revealNextPair() {
  const pairs = await getPairs();
  const gameState = await getGameState();

  const currentIndex = gameState.currentPairIndex;

  if (currentIndex >= pairs.length) {
    await updateGameState({ status: 'finished' });
    return null;
  }

  // 標記當前配對為已揭曉（animationComplete 初始為 false，動畫完成後由 viewer 設為 true）
  const currentPair = pairs[currentIndex];
  await refs.pairs.child(currentPair.id).update({ revealed: true, animationComplete: false });

  // 更新遊戲狀態
  const newIndex = currentIndex + 1;
  if (newIndex >= pairs.length) {
    await updateGameState({
      status: 'finished',
      currentPairIndex: newIndex
    });
  } else {
    await updateGameState({
      currentPairIndex: newIndex
    });
  }

  return currentPair;
}

// 重置遊戲
async function resetGame() {
  await refs.pairs.remove();
  await updateGameState({
    status: 'waiting',
    currentPairIndex: 0
  });
}

// 完全重置 (包含參與者)
async function fullReset() {
  await refs.participants.remove();
  await refs.pairs.remove();
  await updateGameState({
    status: 'waiting',
    currentPairIndex: 0
  });
}

// === 即時監聽 ===

// 監聽遊戲狀態變化
function onGameStateChange(callback) {
  refs.gameState.on('value', (snapshot) => {
    const state = snapshot.val() || {
      status: 'waiting',
      currentPairIndex: 0
    };
    callback(state);
  });
}

// 監聽配對變化
function onPairsChange(callback) {
  refs.pairs.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    const pairs = Object.entries(data).map(([id, value]) => ({
      id,
      ...value
    })).sort((a, b) => a.revealOrder - b.revealOrder);
    callback(pairs);
  });
}

// 監聽參與者變化
function onParticipantsChange(callback) {
  refs.participants.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    const participants = Object.entries(data).map(([id, value]) => ({
      id,
      ...value
    })).sort((a, b) => a.order - b.order);
    callback(participants);
  });
}

// === 雪花效果 ===
function createSnowflakes() {
  const container = document.createElement('div');
  container.className = 'snowflakes';
  document.body.appendChild(container);

  const snowflakeChars = ['❄', '❅', '❆', '✻', '✼'];

  for (let i = 0; i < 30; i++) {
    const snowflake = document.createElement('div');
    snowflake.className = 'snowflake';
    snowflake.textContent = snowflakeChars[Math.floor(Math.random() * snowflakeChars.length)];
    snowflake.style.left = Math.random() * 100 + '%';
    snowflake.style.animationDuration = (Math.random() * 5 + 5) + 's';
    snowflake.style.animationDelay = Math.random() * 10 + 's';
    snowflake.style.fontSize = (Math.random() * 10 + 10) + 'px';
    container.appendChild(snowflake);
  }
}
