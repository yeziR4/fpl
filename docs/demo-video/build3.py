import json,re
head=open('comp.html').read().split('</style>')[0]+'</style></head>\n<body>\n'
body=open('comp3_body.html').read().replace('<script>','<style>'+open('theme3.css').read()+'</style>\n<script>',1)
for n in ['claude-color','openai','gemini-color','grok','deepseek-color']:
    s=open(f'assets/logo/{n}.svg').read()
    s=re.sub(r'\s(width|height)="1em"','',s).replace('currentColor','#0e1512').replace('style="flex:none;line-height:1"','')
    body=body.replace(f'__LOGO_{n}__',s)
cues=json.load(open('vo3/cues.json'))
h=json.load(open('/home/user/fpl/data/human_picks.json'))
q={p['handle'][1:]:p['predictions'][0]['reasoning'].replace('"','&quot;') for p in h['participants']}
open('render.html','w').write((head+body).replace('__CUES__',json.dumps(cues)).replace('HUMANS_Q',json.dumps(q)))
