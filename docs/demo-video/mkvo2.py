import json,sys,soundfile as sf
from kokoro_onnx import Kokoro
VOICE=sys.argv[1] if len(sys.argv)>1 else 'af_heart'; OUT=sys.argv[2] if len(sys.argv)>2 else 'vo2'
import os; os.makedirs(OUT,exist_ok=True)
k=Kokoro('../kokoro/kokoro.onnx','../kokoro/voices.bin')
lines=json.load(open('script2.json')); t=0.6; cues=[]
for cid,txt,gap in lines:
    say=txt.replace('FPL','F.P.L.').replace('GPT','G.P.T.').replace('API','A.P.I.').replace('João','Zhwow').replace('AI models','A.I. models')
    a,sr=k.create(say,voice=VOICE,speed=0.97,lang='en-us')
    sf.write(f'{OUT}/{cid}.wav',a,sr); d=len(a)/sr
    cues.append({'id':cid,'text':txt,'start':round(t,3),'dur':round(d,3)}); t+=d+gap
json.dump({'total':round(t+0.5,2),'voice':VOICE,'cues':cues},open(f'{OUT}/cues.json','w'),indent=1)
print(VOICE,round(t,1))
