import json
c=json.load(open('cues.json')); s=open('src.html').read().replace('/*CUES*/',json.dumps(c)); open('aiq.html','w').write(s)
