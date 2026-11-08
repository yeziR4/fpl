s=open('long_src.html').read().replace('/*CUES*/',open('cues_long.json').read()).replace('const T = 210;','const T = 210; window.ANIM = {p:158,c:158};')
open('long.html','w').write(s)
