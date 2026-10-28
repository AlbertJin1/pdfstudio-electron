"""Score docx conversions against the source PDF: word recall/precision + visual similarity.
usage: score.py source.pdf converted.docx [workdir]"""
import sys, os, re, subprocess, tempfile, shutil
from PIL import Image, ImageChops, ImageFilter
import numpy as np
src, docx = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
shutil.copy(docx, os.path.join(tmp, 'c.docx'))
subprocess.run(['python3','/mnt/skills/public/docx/scripts/office/soffice.py','--headless','--convert-to','pdf','--outdir',tmp,os.path.join(tmp,'c.docx')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=240)
cpdf = os.path.join(tmp,'c.pdf')
def words(pdf):
    t = subprocess.run(['pdftotext','-layout',pdf,'-'],capture_output=True,text=True).stdout
    return re.findall(r"[A-Za-z0-9]+", t.lower())
from collections import Counter
a, b = Counter(words(src)), Counter(words(cpdf))
inter = sum((a & b).values())
recall = inter/max(1,sum(a.values())); prec = inter/max(1,sum(b.values()))
missing = list((a-b).elements())[:25]; extra = list((b-a).elements())[:25]
def pages(pdf, tag):
    subprocess.run(['pdftoppm','-r','50','-gray',pdf,os.path.join(tmp,tag)],check=True)
    return sorted(f for f in os.listdir(tmp) if f.startswith(tag+'-') and f.endswith('.pgm'))
pa, pb = pages(src,'s'), pages(cpdf,'c')
sims=[]
for i in range(min(len(pa),len(pb))):
    A=Image.open(os.path.join(tmp,pa[i])); B=Image.open(os.path.join(tmp,pb[i])).resize(A.size)
    # blur so 1-2px offsets do not dominate; compare ink maps
    A=A.filter(ImageFilter.GaussianBlur(1.5)); B=B.filter(ImageFilter.GaussianBlur(1.5))
    d=np.abs(np.asarray(A,float)-np.asarray(B,float)).mean()/255
    sims.append(round(100*(1-d*4 if d*4<1 else 0),1))
print(f"pages src={len(pa)} out={len(pb)} | word recall={recall*100:.1f}% precision={prec*100:.1f}% | visual={sims}")
print(" missing:",' '.join(missing)); print(" extra:",' '.join(extra))
shutil.rmtree(tmp)
