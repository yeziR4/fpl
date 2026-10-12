import json
cues=json.load(open('cues.json'))
h=json.load(open('/home/user/fpl/data/human_picks.json'))
q={p['handle'][1:]:p['predictions'][0]['reasoning'].replace('"','&quot;') for p in h['participants']}
s=open('comp.html').read().replace('__CUES__',json.dumps(cues)).replace('HUMANS_Q',json.dumps(q))
open('render.html','w').write(s)
