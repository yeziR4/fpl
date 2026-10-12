import numpy as np, json, wave
SR=44100; cues=json.load(open('cues.json')); T=cues['total']; C={c['id']:c for c in cues['cues']}
N=int(T*SR); out=np.zeros((N,2))
BPM=112; beat=60/BPM; bar=beat*4
rng=np.random.default_rng(7)
def note(m): return 440*2**((m-69)/12)
def lp(x,a):  # one-pole lowpass, a in (0,1)
    y=np.empty_like(x); s=0.0
    for i in range(len(x)): s+=a*(x[i]-s); y[i]=s
    return y
def lp_fast(x,cut):
    # FFT brickwall-ish smooth lowpass
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR); X*=1/(1+(f/cut)**4); return np.fft.irfft(X,len(x))
def add(sig,t,pan=0.0,g=1.0):
    i=int(t*SR); j=min(N,i+len(sig)); 
    if i>=N: return
    s=sig[:j-i]*g; out[i:j,0]+=s*(1-pan)*0.5*2**0.5*0.71; out[i:j,1]+=s*(1+pan)*0.5*2**0.5*0.71
tt=lambda d: np.arange(int(d*SR))/SR
def kick(g=1):
    t=tt(0.45); f=45+80*np.exp(-t*30); ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-t*7)*g + 0.3*np.exp(-t*200)*rng.standard_normal(len(t))*0.2
def hat(d=0.06):
    t=tt(d); n=rng.standard_normal(len(t)); n=n-lp_fast(n,7000); return n*np.exp(-t*60)*0.25
def clap():
    t=tt(0.25); n=lp_fast(rng.standard_normal(len(t)),3000); n=n-lp_fast(n,900)
    env=np.exp(-t*18)*(1+0.6*np.exp(-((t-0.012)*300)**2)); return n*env*0.5
def saw(f,t,det=0.0):
    return 2*((t*f*(1+det))%1)-1
def pad(chord,d):
    t=tt(d); s=np.zeros(len(t))
    for m in chord:
        for det in (-0.004,0,0.005): s+=saw(note(m),t,det)
    s=lp_fast(s,1400)/ (len(chord)*3)
    env=np.minimum(1,t/0.6)*np.minimum(1,(d-t)/0.6); return s*env
def bass(m,d):
    t=tt(d); f=note(m); s=np.sin(2*np.pi*f*t)+0.35*np.sin(4*np.pi*f*t)+0.15*saw(f,t)
    return s*np.exp(-t*1.2)*np.minimum(1,t/0.01)*np.minimum(1,(d-t)/0.03)*0.55
def impact():
    t=tt(3.0); f=30+60*np.exp(-t*8); s=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*1.5)
    n=lp_fast(rng.standard_normal(len(t)),2500)*np.exp(-t*3)*0.4; return (s+n)*0.9
def riser(d):
    t=tt(d); n=rng.standard_normal(len(t)); 
    # sweep: mix of lp at increasing cut via chunks
    o=np.zeros(len(t)); seg=int(0.1*SR)
    for k in range(0,len(t),seg):
        c=300+ (k/len(t))**2*8000; o[k:k+seg]=lp_fast(n[k:k+seg+0],c)[:len(o[k:k+seg])]
    return o*(t/d)**2*0.35
# chord progression Am F C G (minor, driven)
prog=[([57,60,64,69],45),([53,57,60,65],41),([48,55,60,64],48),([55,59,62,67],43)]
def section(t0,t1,kickon=True,hats=True,claps=False,bassOn=True,padg=0.35,kg=0.9):
    nb=int((t1-t0)/bar)
    for b in range(nb):
        tb=t0+b*bar; ch,bn=prog[b%4]
        add(pad(ch,bar+0.3),tb,0,padg)
        for q in range(4):
            tq=tb+q*beat
            if kickon: add(kick(),tq,0,kg)
            if hats: add(hat(),tq+beat/2,0.3,0.8); add(hat(0.03),tq+beat*0.75,-0.3,0.35)
            if claps and q in (1,3): add(clap(),tq,0,0.6)
            if bassOn:
                add(bass(bn,beat*0.45),tq+beat*0.5,0,1)
                add(bass(bn,beat*0.3),tq+beat*0.0,0,0.5) if q==0 else None
# 1. hook: pad + heartbeat kick on 1 and 3 (0 -> i1)
t_i1=C['i1']['start']-0.2
nb=int(t_i1/bar)
for b in range(nb+1):
    tb=b*bar; ch,bn=prog[b%4]
    add(pad(ch,bar+0.3),tb,0,0.18+0.12*b/nb)
    if b>=1: add(kick(),tb,0,0.6); add(kick(),tb+beat*2,0,0.45)
add(riser(2.2),t_i1-2.2,0,1)
add(impact(),t_i1,0,0.6)
# 2. groove until r1
t_r1=C['r1']['start']-0.3
section(t_i1,t_r1-0.0,claps=False)
# tension during price/model part: add claps from p1
section(C['f1']['start']-0.3,t_r1,kickon=False,hats=False,claps=True,bassOn=False,padg=0.0)
# 3. reveal: silence, riser into r2, impact at r4
add(riser(1.6),C['r2']['start']-1.6,0,0.8)
add(impact(),C['r2']['start']-0.05,0,0.5)
add(impact(),C['r3']['start']-0.05,0,0.5)
add(impact(),C['r4']['start']-0.05,0,1.0)
# low drone under reveal
d=C['r5']['start']-C['r2']['start']; add(pad([45,52,57],d),C['r2']['start'],0,0.3)
# 4. second groove: r5 -> e1
t_r5=C['r5']['start']-0.2; t_e1=C['e1']['start']-0.2
section(t_r5,C['t1']['start']-0.2,kickon=False,hats=True,bassOn=True,padg=0.3)
section(C['t1']['start']-0.2,t_e1,claps=True,padg=0.32,kg=1.0)
add(riser(2.0),t_e1-2.0,0,0.8)
# 5. end chord
add(impact(),t_e1,0,0.7)
add(pad([57,60,64,69,72],T-t_e1),t_e1,0,0.5)
add(bass(45,4.0),t_e1,0,1.2)
# simple stereo reverb
def verb(x):
    y=np.copy(x)
    for dly,g in ((0.031,0.3),(0.047,0.25),(0.071,0.2),(0.113,0.15),(0.167,0.1)):
        k=int(dly*SR); y[k:]+=x[:-k]*g
    return y
out[:,0]=verb(out[:,0]); out[:,1]=verb(out[:,1][::-1])[::-1]*0+verb(out[:,1])
# ducking under VO
duck=np.ones(N)
for c in cues['cues']:
    i=int((c['start']-0.1)*SR); j=int((c['start']+c['dur']+0.1)*SR); duck[i:j]=0.45
k=int(0.15*SR); duck=np.convolve(duck,np.ones(k)/k,'same')
out*=duck[:,None]
out/=np.max(np.abs(out))+1e-9; out*=0.85
fade=int(1.5*SR); out[-fade:]*=np.linspace(1,0,fade)[:,None]
w=wave.open('music.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out*32767).astype('<i2').tobytes()); w.close()
print('ok',T)
