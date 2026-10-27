// Graphics quality (Settings > Graphics quality): 'auto', 'high' or 'low'.
// Low suits TVs and other weak devices: the globe draws at a lower
// resolution with simpler filtering, no antialiasing, no extra-sharp
// imagery and at most 30 frames a second; map images are fetched at half
// size; and the page drops its blur effects and decorative animations.
// Auto picks Low on TVs and devices with very few cores or little memory.
// It's read once at start-up (the app reloads when it changes), since some
// of it can only be set when the 3D view is created.
const read = () => { try { return JSON.parse(localStorage.getItem('fc.quality')); } catch { return null; } };
export const qualitySetting = ['auto', 'high', 'low'].includes(read()) ? read() : 'auto';

// Smart TV and streaming-stick browsers (Samsung Tizen, LG webOS, Android
// TV / Google TV, Fire TV, Sony, Philips, Hisense, HbbTV...).
export const isTV = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Android ?TV|GoogleTV|\bAFT[A-Z]|CrKey|Roku|HbbTV|PhilipsTV|VIDAA|Opera TV|\bTV\b/i.test(navigator.userAgent);
const weak = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;

export const lowPower = qualitySetting === 'low' || (qualitySetting === 'auto' && (isTV || weak));

// Map image sizes: half as many pixels each way on Low.
export const px = n => (lowPower ? Math.round(n / 2) : n);
