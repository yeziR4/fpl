import json,re
s=open('pitch_body.html').read().replace('A/','../v/assets/')
logos=''
for n in ['claude-color','openai','gemini-color','grok','deepseek-color']:
    v=open(f'../v/assets/logo/{n}.svg').read()
    v=re.sub(r'\s(width|height)="1em"','',v).replace('currentColor','#0e1512').replace('style="flex:none;line-height:1"','')
    logos+=f'<div class="logo">{v}</div>'
s=s.replace('__LOGOS__',logos).replace('__CUES__',json.dumps(json.load(open('cues.json'))))
open('render.html','w').write(s)
