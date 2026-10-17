import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

const ONLINE_WINDOW_MS = 75_000;
const $ = id => document.getElementById(id);
const locationStates = { pending: 'Laukiama patvirtinimo', declined: 'Atmesta', error: 'Nepavyko nustatyti', expired: 'Pasibaigė' };
let adminCode = '';
let members = [];
let refreshTimer;

async function adminRpc(name, parameters = {}) {
  let response;
  try {
    response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: adminCode, ...parameters }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error('Nepavyko pasiekti serverio. Patikrinkite interneto ryšį.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || 'Nepavyko gauti narių sąrašo.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function listMembers() {
  return adminRpc('admin_list_members');
}

async function requestExactLocation(memberId, button) {
  button.disabled = true;
  try {
    await adminRpc('admin_request_location', { p_member_id: memberId });
    members = await listMembers();
    render();
    setStatus('Vietos bendrinimo prašymas išsiųstas. Vartotojas galės jį patvirtinti arba atmesti.');
  } catch (error) {
    setStatus(error.status === 401 || error.status === 403 ? 'Administratoriaus kodas nebegalioja.' : error.message, true);
    button.disabled = false;
  }
}

function setStatus(message = '', error = false) {
  $('admin-status').textContent = message;
  $('admin-status').classList.toggle('error', error);
}

function online(member) {
  const seen = new Date(member.last_seen_at).getTime();
  return Number.isFinite(seen) && Date.now() - seen < ONLINE_WINDOW_MS;
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Dar nebuvo aktyvus';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('lt-LT', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {})
  }).format(date);
}

function render() {
  const query = $('member-search').value.trim().toLocaleLowerCase('lt');
  const filter = $('status-filter').value;
  const visible = members.filter(member => {
    const isOnline = online(member);
    return (!query || member.nickname.toLocaleLowerCase('lt').includes(query) || member.id.toLowerCase().includes(query))
      && (filter === 'all' || (filter === 'online') === isOnline);
  });
  const body = $('member-rows');
  body.replaceChildren();
  for (const member of visible) {
    const row = document.createElement('tr');
    const identity = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = member.nickname;
    const id = document.createElement('small');
    id.textContent = member.id;
    identity.append(name, id);
    const state = document.createElement('td');
    const badge = document.createElement('span');
    const isOnline = online(member);
    badge.className = 'presence ' + (isOnline ? 'online' : 'offline');
    badge.textContent = isOnline ? 'Prisijungęs' : 'Atsijungęs';
    const lastActive = document.createElement('small');
    lastActive.textContent = 'Aktyvumas: ' + formatDate(member.last_seen_at, true);
    state.append(badge, lastActive);
    const sessionStarted = document.createElement('td');
    sessionStarted.textContent = formatDate(member.session_started_at, true);
    const device = document.createElement('td');
    const deviceName = document.createElement('strong');
    deviceName.textContent = member.device_type || 'Nežinoma';
    const deviceDetails = document.createElement('small');
    deviceDetails.textContent = [member.os_name, member.browser_name].filter(Boolean).join(' · ') || '—';
    device.append(deviceName, deviceDetails);
    const approximate = document.createElement('td');
    approximate.textContent = member.approx_location || 'Nenustatyta';
    const exact = document.createElement('td');
    exact.className = 'exact-location-cell';
    if (Number.isFinite(member.exact_latitude) && Number.isFinite(member.exact_longitude)) {
      const coordinates = `${member.exact_latitude.toFixed(6)}, ${member.exact_longitude.toFixed(6)}`;
      const coordinateActions = document.createElement('div');
      coordinateActions.className = 'coordinate-actions';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'coordinate-copy';
      copy.textContent = coordinates;
      copy.title = 'Kopijuoti koordinates';
      copy.setAttribute('aria-label', `Kopijuoti koordinates ${coordinates}`);
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(coordinates);
          setStatus('Koordinatės nukopijuotos.');
        } catch {
          setStatus('Koordinačių nukopijuoti nepavyko.', true);
        }
      });
      const map = document.createElement('a');
      map.className = 'coordinate-map';
      map.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
      map.target = '_blank';
      map.rel = 'noopener noreferrer';
      map.referrerPolicy = 'no-referrer';
      map.textContent = 'Žemėlapis ↗';
      map.setAttribute('aria-label', `Atverti koordinates ${coordinates} Google Maps`);
      coordinateActions.append(copy, map);
      const coordinateInfo = document.createElement('small');
      coordinateInfo.textContent = `±${Math.round(member.exact_accuracy_m || 0)} m · ${formatDate(member.location_captured_at, true)}`;
      exact.append(coordinateActions, coordinateInfo);
      if (member.location_status && member.location_status !== 'approved') {
        const previous = document.createElement('small');
        previous.className = 'coordinate-state';
        previous.textContent = `Ankstesnė patvirtinta vieta · Paskutinis prašymas: ${locationStates[member.location_status] || member.location_status}`;
        exact.append(previous);
      }
    } else {
      exact.textContent = locationStates[member.location_status] || 'Negauta';
    }
    const rhythms = document.createElement('td');
    rhythms.textContent = String(member.rhythm_count || 0);
    const joined = document.createElement('td');
    joined.textContent = formatDate(member.created_at);
    const controls = document.createElement('td');
    const request = document.createElement('button');
    request.type = 'button';
    request.className = 'action';
    request.textContent = member.location_status === 'pending' ? 'Prašymas išsiųstas' : 'Prašyti vietos';
    request.disabled = member.location_status === 'pending';
    request.addEventListener('click', () => requestExactLocation(member.id, request));
    controls.append(request);
    row.append(identity, state, sessionStarted, device, approximate, exact, rhythms, joined, controls);
    body.append(row);
  }
  $('members-empty').hidden = visible.length !== 0;
  const active = members.filter(online).length;
  $('admin-summary').textContent = `Iš viso: ${members.length} · Prisijungę: ${active} · Atsijungę: ${members.length - active}`;
}

function showLogin(message = '', error = false) {
  clearInterval(refreshTimer);
  adminCode = '';
  $('admin-panel').hidden = true;
  $('admin-login').hidden = false;
  setStatus(message, error);
}

function showPanel() {
  $('admin-login').hidden = true;
  $('admin-panel').hidden = false;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(true), 15_000);
}

async function refresh(silent = false) {
  if (!adminCode) return showLogin();
  if (!silent) setStatus('Atnaujinama…');
  $('admin-refresh').disabled = true;
  try {
    members = await listMembers();
    render();
    setStatus('');
  } catch (error) {
    if (error.status === 401 || error.status === 403) showLogin('Neteisingas administratoriaus kodas.', true);
    else setStatus(error.message, true);
  } finally {
    $('admin-refresh').disabled = false;
  }
}

$('admin-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('admin-login-button').disabled = true;
  adminCode = $('admin-code').value;
  $('admin-code').value = '';
  try {
    members = await listMembers();
    showPanel();
    render();
    setStatus('');
  } catch (error) {
    showLogin(error.status === 401 || error.status === 403 ? 'Neteisingas administratoriaus kodas.' : error.message, true);
  } finally {
    $('admin-login-button').disabled = false;
  }
});
$('admin-refresh').addEventListener('click', () => refresh());
$('admin-logout').addEventListener('click', () => showLogin('Atsijungta.'));
$('member-search').addEventListener('input', render);
$('status-filter').addEventListener('change', render);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && adminCode) refresh(true);
});

showLogin();
