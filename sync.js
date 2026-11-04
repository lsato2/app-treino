// Login com Google + sincronização com o Firestore.
// Estrutura no banco:  users/{uid}            → { json: <configurações, cargas, perfil...>, email, updatedAt }
//                      users/{uid}/history/{end} → { json: <um treino> }
// O app continua funcionando offline: as gravações ficam na fila e sobem quando houver conexão.
import { firebaseConfig } from './firebase-config.js';

const V = '10.12.2';
const cloud = window.cloud = { configured: !!firebaseConfig, user: null, status: 'off', lastSync: null, error: null };
const setStatus = (status, error = null) => {
  Object.assign(cloud, { status, error });
  if (status === 'ok') cloud.lastSync = Date.now();
  window.onCloudStatus && window.onCloudStatus();
};

if (firebaseConfig) init().catch(() => setStatus('error', 'Sem conexão com o Google agora. Você pode continuar sem login e entrar depois pelo Perfil.'));
else window.onCloudStatus && window.onCloudStatus();

async function init() {
  setStatus('loading');
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache() });   // fila offline
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  cloud.signIn = async () => {
    try { await A.signInWithPopup(auth, provider); }
    catch (e) {
      // No app instalado no iPhone o popup pode ser bloqueado: tenta por redirecionamento
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) return A.signInWithRedirect(auth, provider);
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') setStatus('error', friendly(e));
    }
  };
  cloud.signOut = async () => { await A.signOut(auth); };
  cloud.syncNow = () => pullThenPush();
  A.getRedirectResult(auth).catch(e => setStatus('error', friendly(e)));

  const userDoc = () => F.doc(db, 'users', cloud.user.uid);
  const histCol = () => F.collection(db, 'users', cloud.user.uid, 'history');
  const pushedKey = () => `treino-pushed:${cloud.user.uid}`;
  const getPushed = () => { try { return JSON.parse(localStorage.getItem(pushedKey())) || {}; } catch (e) { return {}; } };
  const setPushed = p => { try { localStorage.setItem(pushedKey(), JSON.stringify(p)); } catch (e) {} };
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

  async function pull() {
    const [m, hs] = await Promise.all([F.getDoc(userDoc()), F.getDocs(histCol())]);
    const remoteMeta = m.exists() ? JSON.parse(m.data().json) : null;
    const remoteHist = hs.docs.map(d => JSON.parse(d.data().json));
    S = mergeStates(S, remoteMeta, remoteHist);            // mergeStates fica no script principal
    saveLocal();
    // Marca como já enviados os treinos que vieram iguais do servidor
    const pushed = getPushed(); hs.docs.forEach(d => { pushed[d.id] = hash(d.data().json); }); setPushed(pushed);
    cloud.pulled = true;
    if (window.safeRender) window.safeRender();
  }
  let pushing = null, again = false;
  async function push() {
    if (!cloud.user) return;
    if (pushing) { again = true; return pushing; }
    pushing = (async () => {
      setStatus('syncing');
      const pushed = getPushed(); const ops = [];
      const { history, ...meta } = S;
      ops.push(b => b.set(userDoc(), { json: JSON.stringify(meta), email: cloud.user.email || '', updatedAt: F.serverTimestamp() }));
      for (const h of history) {
        const j = JSON.stringify(h), hs = hash(j), id = String(h.end);
        if (pushed[id] !== hs) { ops.push(b => b.set(F.doc(histCol(), id), { json: j })); pushed[id] = hs; }
      }
      for (const end of S.deleted || []) {
        const id = String(end);
        if (pushed[id] !== 'del') { ops.push(b => b.delete(F.doc(histCol(), id))); pushed[id] = 'del'; }
      }
      for (let i = 0; i < ops.length; i += 400) {             // limite de 500 operações por lote
        const b = F.writeBatch(db); ops.slice(i, i + 400).forEach(f => f(b));
        const commit = b.commit();
        if (!navigator.onLine) { setStatus('offline'); commit.then(() => setStatus('ok')).catch(e => setStatus('error', friendly(e))); }
        else await commit;
      }
      setPushed(pushed);
      if (navigator.onLine) setStatus('ok');
    })().catch(e => setStatus('error', friendly(e))).finally(() => { pushing = null; if (again) { again = false; push(); } });
    return pushing;
  }
  async function pullThenPush() {
    if (!cloud.user) return;
    try { setStatus('syncing'); await pull(); await push(); }
    catch (e) { cloud.pulled = true; setStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? friendly(e) : null); }
  }
  let timer = null;
  window.cloudPush = () => { if (!cloud.user) return; clearTimeout(timer); timer = setTimeout(push, 2500); };
  window.addEventListener('online', () => cloud.user && pullThenPush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cloud.user) pullThenPush(); });

  A.onAuthStateChanged(auth, u => {
    cloud.user = u ? { uid: u.uid, email: u.email, name: u.displayName, photo: u.photoURL } : null;
    if (u) { cloud.pulled = false; pullThenPush(); } else { cloud.pulled = false; setStatus('signed-out'); }
  });
}

function friendly(e) {
  const c = e && e.code || '';
  if (c === 'permission-denied' || c === 'firestore/permission-denied') return 'Sem permissão no banco de dados. Confira as regras do Firestore.';
  if (c === 'auth/unauthorized-domain') return 'Domínio não autorizado no Firebase (Authentication → Configurações → Domínios autorizados).';
  if (c === 'auth/network-request-failed') return 'Sem conexão. Tente de novo quando tiver internet.';
  return (e && e.message) || String(e);
}
