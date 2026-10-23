import numpy as np, wave
SR=44100; T=32.0; N=int(T*SR); L=np.zeros(N); R=np.zeros(N); KICKS=[]
rng=np.random.default_rng(3); B=0.5
def tt(d): return np.arange(int(d*SR))/SR
def lp(x,c):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR); X/=1+(f/c)**4; return np.fft.irfft(X,len(x))
def hp(x,c): return x-lp(x,c)
def add(sig,t,g=1,pan=0):
    i=int(t*SR)
    if i>=N or i<0: return
    j=min(N,i+len(sig)); s=sig[:j-i]*g; L[i:j]+=s*(1-max(0,pan)); R[i:j]+=s*(1+min(0,pan))
note=lambda m:440*2**((m-69)/12)
def kick():
    t=tt(.4); f=48+110*np.exp(-t*35); return np.tanh(2.2*np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*8))*.9
def clap():
    t=tt(.3); n=hp(lp(rng.standard_normal(len(t)),4000),900); e=np.exp(-t*20)
    for k in (0.0,0.011,0.022): e+=0.6*np.exp(-((t-k)*400)**2)
    return n*e*.35
def hat(d=.05,o=False):
    t=tt(.25 if o else d); n=hp(rng.standard_normal(len(t)),8000); return n*np.exp(-t*(12 if o else 70))*.22
def saw(f,t): return 2*((t*f)%1)-1
def stab(ch,d=.35,cut=2600):
    t=tt(d); s=sum(saw(note(m)*(1+dt),t) for m in ch for dt in (-.006,0,.007))/(len(ch)*3)
    return lp(s*np.exp(-t*5)*np.minimum(1,t/.004),cut)
def pad(ch,d,cut=1400):
    t=tt(d); s=sum(saw(note(m)*(1+dt),t) for m in ch for dt in (-.004,.004))/(len(ch)*2)
    return lp(s,cut)*np.minimum(1,t/.5)*np.minimum(1,(d-t)/.5)
def bass(m,d=.22):
    t=tt(d); f=note(m); s=np.tanh(1.6*(np.sin(2*np.pi*f*t)+.4*saw(f,t)))
    return lp(s,900)*np.minimum(1,t/.005)*np.minimum(1,(d-t)/.02)*.5
def pluck(m,d=.25):
    t=tt(d); f=note(m); s=np.sign(np.sin(2*np.pi*f*t))*.5+saw(f,t)*.5; return lp(s,3000)*np.exp(-t*14)*.18
def blip(m):
    t=tt(.18); return np.sin(2*np.pi*note(m)*t)*np.exp(-t*25)*.35
def click():
    t=tt(.02); return hp(rng.standard_normal(len(t)),3000)*np.exp(-t*300)*.25
def riser(d):
    t=tt(d); n=rng.standard_normal(len(t)); o=np.zeros(len(t)); seg=int(.05*SR)
    for k in range(0,len(t),seg): o[k:k+seg]=lp(n[k:k+seg],400+(k/len(t))**2.2*9000)[:len(o[k:k+seg])]
    return o*(t/d)**2.2*.4
def impact():
    t=tt(2.5); f=32+70*np.exp(-t*10); s=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*2)
    return np.tanh(1.5*s)+lp(rng.standard_normal(len(t)),1800)*np.exp(-t*4)*.35
PROG=[([57,60,64,69],45),([53,57,60,65],41),([48,55,60,64],48),([55,59,62,67],43)]  # Am F C G
def groove(t0,t1,kick_on=True,clap_on=True,hats=True,bass_on=True,stabs=True,arp=False,padg=.0):
    t=t0
    while t<t1-1e-6:
        bar=int(round((t-8)/2))%4; ch,bn=PROG[bar]
        if padg: add(pad([c-12 for c in ch]+ch[:2],2.1),t,padg)
        for q in range(4):
            tq=t+q*B
            if tq>=t1: break
            if kick_on: add(kick(),tq,1); KICKS.append(tq)
            if clap_on and q in (1,3): add(clap(),tq,1)
            if hats: add(hat(o=True),tq+B/2,.6,.3); add(hat(),tq+B/4,.5,-.3); add(hat(),tq+3*B/4,.4,.3)
            if bass_on:
                for e in (.25,.5,.75): add(bass(bn),tq+e*B,1)
            if stabs and q in (0,2) and (q==0 or bar%2==1): add(stab(ch),tq+(.75*B if q==2 else 0),.55)
            if arp:
                for e in range(4): add(pluck(ch[(q*4+e)%4]+12),tq+e*B/4,1,(-.4 if e%2 else .4))
        t+=2
PROG[:]=[([62,65,69,72],50),([58,62,65,69],46),([60,64,67,71],48),([57,60,64,67],45)]  # Dm Bb C Am
def popn():
    t=tt(.12); return (np.sin(2*np.pi*(880+600*np.exp(-t*40))*t))*np.exp(-t*30)*.45
def chime():
    t=tt(.8); return sum(np.sin(2*np.pi*f*t)*np.exp(-t*4) for f in (1046.5,1318.5,1568))/3*.6
def kach():
    t=tt(.8); return sum(np.sin(2*np.pi*f*t)*np.exp(-t*k) for f,k in ((2093,6),(2637,7),(3136,8)))/3*.6+hp(rng.standard_normal(len(t)),6000)*np.exp(-t*40)*.25
def err():
    t=tt(.35); f=180; return lp(np.sign(np.sin(2*np.pi*f*t))*.5+saw(f*1.01,t)*.5,1500)*np.exp(-t*6)*.4
def whoosh(d=.7):
    t=tt(d); n=rng.standard_normal(len(t)); o=np.zeros(len(t)); seg=int(.03*SR)
    for k in range(0,len(t),seg): c=800+5000*np.sin(np.pi*k/len(t)); o[k:k+seg]=lp(n[k:k+seg],c)[:len(o[k:k+seg])]
    return o*np.sin(np.pi*t/d)*.35
import json
T=82.0; N=int(T*SR); L=np.zeros(N); R=np.zeros(N); KICKS.clear()
def tick():
    t=tt(.06); return np.sin(2*np.pi*2400*t)*np.exp(-t*90)*.3
def hitf():
    t=tt(.5); f=60+90*np.exp(-t*30); return np.tanh(2*np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*9))*.6+hp(rng.standard_normal(len(t)),2000)*np.exp(-t*25)*.25
def send():
    t=tt(.4); f=500+1600*(t/.4)**1.5; return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*6)*.25
def swish(): return whoosh(.45)*.8
# --- music
add(pad([50,57,62,65],9.2,900),0,.55)
for k in range(16): add(pluck([62,65,69,72][k%4]+12,.2),0.5+k*.5,.7,(-.3 if k%2 else .3))
for k in range(8): add(hat(),4.6+k*.5,.35)
add(riser(1.6),7.5,.6)
add(impact(),9.05,.9); add(stab([62,65,69,74],.9),9.05,.7)
groove(9.05,54.3,arp=False,padg=.08)
groove(54.3,69.45,clap_on=False,stabs=False,arp=True,padg=.1)
add(riser(1.3),68.2,.55)
add(impact(),69.5,.7)
groove(69.5,75.4,arp=True,padg=.1)
add(riser(1.0),74.4,.5)
add(impact(),75.45,1.0); add(stab([62,65,69,74],1.2),75.45,.8)
add(pad([50,57,62,65,69],T-75.45,1600),75.45,.6); add(bass(38,3.0),75.45,1.0)
for k in range(6): add(pluck([74,77,81,86][k%4],.4),75.95+k*.5,.6)
# sidechain pump
env=np.ones(N); pl=int(.32*SR); shape=1-.65*np.exp(-np.arange(pl)/SR*9)
for k in KICKS:
    i=int(k*SR); j=min(N,i+pl); env[i:j]=np.minimum(env[i:j],shape[:j-i])
mix=np.stack([L,R],1)
# kicks shouldn't be pumped by themselves: approximate by applying env to all (kick transient survives)
mix*=env[:,None]**.8
def verb(x):
    y=x.copy()
    for d,g in ((.023,.25),(.041,.2),(.067,.15),(.109,.1),(.173,.07)): k=int(d*SR); y[k:]+=x[:-k]*g
    return y
mix[:,0]=verb(mix[:,0]); mix[:,1]=verb(mix[:,1])
mix=np.tanh(mix/np.abs(mix).max()*1.6)/np.tanh(1.6)*.92
f=int(1.2*SR); mix[-f:]*=np.linspace(1,0,f)[:,None]
w=wave.open('music.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix*32767).astype('<i2').tobytes()); w.close(); print('music ok')
# --- sfx track
L=np.zeros(N); R=np.zeros(N)
F={'click':click,'pop':popn,'hit':hitf,'err':err,'whoosh':whoosh,'swish':swish,'blip':lambda:blip(88),'tick':tick,'send':send,'kach':kach,'impact':impact,'chime':chime}
for k,t,g in json.load(open('meta.json'))['sfx']: add(F[k](),t,g*(.5 if k=='impact' else 1))
mx=np.stack([L,R],1); mx=np.tanh(mx*1.0)*.8
w=wave.open('sfx.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mx*32767).astype('<i2').tobytes()); w.close(); print('sfx ok')
