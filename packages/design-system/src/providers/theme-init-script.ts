/**
 * A tiny synchronous script injected into <head> BEFORE first paint.
 *
 * Without it, a user who chose "dark" sees one light frame while React hydrates
 * and ThemeProvider reads localStorage.
 *
 * It used to stamp `data-time` from the browser clock as well. Nothing has read
 * that attribute since the circadian ground was retired, and because the server
 * cannot know the viewer's hour it was a hydration mismatch on every page.
 *
 * Kept deliberately tiny, dependency-free and wrapped in try/catch. It is
 * injected with dangerouslySetInnerHTML from a Server Component, so nothing
 * user-supplied ever reaches it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem('mandi.theme');
if(t==='light'||t==='dark'){d.setAttribute('data-theme',t);}
}catch(e){}})();`;
