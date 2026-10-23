import json
c=json.load(open('cues.json')); s=open('src.html').read().replace('/*CUES*/',json.dumps(c)); open('strike.html','w').write(s)
