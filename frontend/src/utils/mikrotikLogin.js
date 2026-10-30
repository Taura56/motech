const STORAGE_KEY = 'motech:router-context';
const ALLOWED_HOSTS = new Set(['login.motechzone.local', '192.168.10.1']);

export function captureRouterContext() {
  const params = new URLSearchParams(window.location.search);
  const context = {
    macAddress: params.get('mac') || '',
    ipAddress: params.get('ip') || '',
    loginUrl: params.get('link-login-only') || '',
    destination: params.get('dst') || params.get('link-orig') || '',
    chapId: params.get('chap-id') || '',
    chapChallenge: params.get('chap-challenge') || ''
  };
  if (context.loginUrl) {
    try {
      const url = new URL(context.loginUrl, window.location.origin);
      if (url.protocol !== 'http:' || !ALLOWED_HOSTS.has(url.hostname)) context.loginUrl = '';
      else context.loginUrl = url.href;
    } catch { context.loginUrl = ''; }
  }
  if (context.macAddress && !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(context.macAddress)) context.macAddress = '';
  if (context.ipAddress && !/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(context.ipAddress)) context.ipAddress = '';
  if (context.loginUrl && context.chapId && context.chapChallenge) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
  }
  return context;
}

export function getRouterContext() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function md5(value) {
  const bytes = new TextEncoder().encode(value);
  const words = [];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] = (words[i >> 2] || 0) | bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | 0x80 << ((bytes.length % 4) * 8);
  const bitLength = bytes.length * 8;
  const blockLength = (((bytes.length + 8) >>> 6) + 1) * 16;
  for (let i = words.length; i < blockLength; i++) words[i] = 0;
  words[blockLength - 2] = bitLength;
  words[blockLength - 1] = 0;
  const shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  const constants = Array.from({length:64}, (_,i) => Math.floor(Math.abs(Math.sin(i+1))*4294967296) >>> 0);
  let a0=0x67452301, b0=0xefcdab89, c0=0x98badcfe, d0=0x10325476;
  const rol=(x,n)=>(x<<n)|(x>>>(32-n));
  for(let offset=0;offset<blockLength;offset+=16){
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){
      let f,g,s;
      if(i<16){f=(b&c)|(~b&d);g=i;s=shifts[i%4];}
      else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;s=shifts[4+i%4];}
      else if(i<48){f=b^c^d;g=(3*i+5)%16;s=shifts[8+i%4];}
      else{f=c^(b|~d);g=(7*i)%16;s=shifts[12+i%4];}
      const next=d;d=c;c=b;b=(b+rol((a+f+constants[i]+words[offset+g])|0,s))|0;a=next;
    }
    a0=(a0+a)|0;b0=(b0+b)|0;c0=(c0+c)|0;d0=(d0+d)|0;
  }
  return [a0,b0,c0,d0].map(n=>[0,8,16,24].map(shift=>((n>>>shift)&255).toString(16).padStart(2,'0')).join('')).join('');
}

export function submitHotspotLogin(username, password, orderId) {
  const context = getRouterContext();
  if (!context.loginUrl || !context.chapId || !context.chapChallenge) return false;
  const marker = `motech:hotspot-login:${orderId}`;
  if (sessionStorage.getItem(marker)) return false;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = context.loginUrl;
  form.style.display = 'none';
  const fields = {
    username,
    password: md5(`${context.chapId}${password}${context.chapChallenge}`),
    dst: context.destination || 'http://neverssl.com/',
    popup: 'true'
  };
  for (const [name,value] of Object.entries(fields)) {
    const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.appendChild(input);
  }
  sessionStorage.setItem(marker, 'submitted');
  document.body.appendChild(form);
  form.submit();
  return true;
}
