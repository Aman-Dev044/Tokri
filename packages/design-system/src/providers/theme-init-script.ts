/**
 * A tiny synchronous script injected into <head> BEFORE first paint.
 *
 * Without it, a user who chose "dark" sees one light frame while React hydrates
 * and ThemeProvider reads localStorage. The same trick stamps `data-time` early
 * so the circadian ground does not visibly snap in after hydration - and it is
 * safe to do here (unlike in SSR) precisely because this runs on the user's own
 * machine, reading the user's own clock.
 *
 * Kept deliberately tiny, dependency-free and wrapped in try/catch. It is
 * injected with dangerouslySetInnerHTML from a Server Component, so nothing
 * user-supplied ever reaches it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem('mandi.theme');
if(t==='light'||t==='dark'){d.setAttribute('data-theme',t);}
var h=new Date().getHours();
d.setAttribute('data-time', h>=5&&h<11?'dawn':h>=11&&h<17?'day':h>=17&&h<21?'dusk':'night');
}catch(e){}})();`;
