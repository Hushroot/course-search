'use strict';
// Synthetic provider only. Refuse ALL other upstream network requests in tests.
const originalFetch = global.fetch;
const html = (text, status = 200, cookies = [], location) => new Response(text, { status, headers: [
  ['Content-Type', 'text/html'], ...cookies.map(c => ['Set-Cookie', c]), ...(location ? [['Location', location]] : []),
] });
const accounts = new Map();
let serial = 0;
global.fetch = async (raw, options = {}) => {
  const url = new URL(String(raw));
  if (url.hostname === '127.0.0.1') return originalFetch(raw, options);
  if (url.origin !== 'https://infinityschool.net') throw new Error('Unmocked network forbidden');
  const cookie = options.headers?.Cookie || '';
  const route = url.pathname;
  const form = options.method === 'POST' ? new URLSearchParams(options.body) : null;
  // IPC assertions use synthetic cookies only; never include passwords or CSRF tokens.
  process.send?.({ route, method: options.method || 'GET', cookie, ajax: options.headers?.['X-Requested-With'], accept: options.headers?.Accept, search: url.search, email: form?.get('email') });
  if (route === '/login' && !form) return html('<form action="https://infinityschool.net/login" method="POST"><input value="csrf&amp;initial" name="_token"><input name="visitor_id"></form>', 200, ['initial=one; Path=/; Secure', 'discard=old; Path=/; Secure']);
  if (route === '/login' && form) {
    if (!cookie.includes('initial=one') || form.get('_token') !== 'csrf&initial' || form.get('password') !== 'synthetic-password' || !/^[a-f0-9]{64}$/.test(form.get('visitor_id'))) return html('bad request', 422);
    const email = form.get('email');
    if (email.startsWith('invalid')) return html('<form action="https://infinityschool.net/login">Invalid credentials</form>');
    if (email.startsWith('challenge')) return html('verification code required');
    if (email.startsWith('device')) return html('maximum devices');
    if (email.startsWith('rate')) return html('wait', 429);
    if (email.startsWith('token')) return html('expired security token', 419);
    if (email.startsWith('outside')) return html('', 302, [], 'https://evil.example/steal');
    if (email.startsWith('slow')) await new Promise(resolve => setTimeout(resolve, 300)); // Deliberately ignore abort to test generation guard.
    const session = `account${++serial}`;
    accounts.set(session, { email, count: 0 });
    return html('', 302, [`session=${session}; Path=/; Secure; HttpOnly`, 'initial=two; Path=/; Secure', 'discard=; Max-Age=0; Path=/; Secure'], '/student_dashboard/home');
  }
  const sid = cookie.match(/(?:^|; )session=([^;]+)/)?.[1];
  const account = accounts.get(sid);
  if (route === '/student_dashboard/home') {
    if (!account) return html('', 302, [], '/login');
    if (!cookie.includes('initial=two') || cookie.includes('discard=')) return html('unexpected cookie jar', 403);
    if (account.email.startsWith('noproof')) return html('Welcome!');
    return html('<nav>student_dashboard</nav><form action="https://infinityschool.net/logout"></form>');
  }
  if (route.includes('/get-video/')) {
    if (cookie === 'test-admin-cookie') return new Response(JSON.stringify({ video: { name: 'Admin metadata', download_url: 'https://vz-a0d715a2-386.b-cdn.net/admin.mp4?token=admin' } }), { headers: { 'Content-Type': 'application/json' } });
    if (!account) return html('', 302, [], '/login');
    if (account.email.startsWith('expired')) return html('', 302, ['session=; Max-Age=0; Path=/; Secure'], '/login');
    if (account.email.startsWith('denied')) return html('Access denied', 403);
    if (account.email.startsWith('unavailable')) return html('provider down', 503);
    if (account.email.startsWith('malformed')) return html('<script>private provider response</script>');
    if (account.email.startsWith('slow')) await new Promise(resolve => setTimeout(resolve, 300));
    account.count++;
    const next = `account${++serial}`;
    accounts.delete(sid); accounts.set(next, account);
    return new Response(JSON.stringify({ video: { download_url: `https://vz-a0d715a2-386.b-cdn.net/${account.email.split('@')[0]}.mp4?token=synthetic` } }), { headers: [['Content-Type', 'application/json'], ['Set-Cookie', `session=${next}; Path=/; Secure; HttpOnly`]] });
  }
  if (route.includes('/get-file/') && cookie === 'test-admin-cookie') return new Response(JSON.stringify({ file: { id: Number(route.split('/').pop()), file_name: 'Admin metadata', lesson: { id: 700, name: 'Example lesson', teacher_id: 3, subject_id: 2, class_section_id: 7 }, lesson_topic: { id: 9, name: 'Example topic' } } }), { headers: { 'Content-Type': 'application/json' } });
  return html('not found', 404);
};
