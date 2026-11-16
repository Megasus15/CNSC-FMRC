"""Build the UCN-FMRC workflow pack. Uses bundled ReportLab/Pillow and Poppler.

The JSON catalog is the only content source. No application or API is invoked.
Run with the bundled Python: python docs/workflows/generate.py
"""
from __future__ import annotations
import argparse, base64, hashlib, html, json, math, re, shutil, subprocess, zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'output/workflow-diagrams'
PDF = ROOT / 'output/pdf/workflows'
QA = ROOT / 'tmp/pdfs/workflows'
W, H = landscape(A3)
COLORS = dict(cream='#FDFAF6', white='#FFFFFF', ink='#273142', muted='#626B78',
              line='#DCDDE2', maroon='#800000', soft='#FBF0F1', blue='#205B80',
              bluesoft='#EFF5FA', green='#246744', greensoft='#EFF7F1',
              amber='#785B16', ambersoft='#FFF6DF', red='#9A3030', redsoft='#FCF0EE')
FONT, BOLD = 'Montserrat', 'Montserrat-Bold'
PDF_LINKS = {}
SVG_FONTS = ''

def init_fonts():
    global SVG_FONTS
    candidates = [ROOT/'docs/workflows/fonts', Path('C:/Windows/Fonts'),
        Path('C:/Users/T480/AppData/Local/Temp')]
    regular = next((p/'Montserrat-Regular.ttf' for p in candidates if (p/'Montserrat-Regular.ttf').exists()), None)
    bold = next((p/'Montserrat-SemiBold.ttf' for p in candidates if (p/'Montserrat-SemiBold.ttf').exists()), None)
    if not regular or not bold:
        raise SystemExit('Place licensed Montserrat-Regular.ttf and Montserrat-SemiBold.ttf in docs/workflows/fonts.')
    pdfmetrics.registerFont(TTFont(FONT, str(regular)))
    pdfmetrics.registerFont(TTFont(BOLD, str(bold)))
    SVG_FONTS = '<style>' + ''.join(
        '@font-face{font-family:Montserrat;font-weight:'+weight+';src:url(data:font/ttf;base64,'+
        base64.b64encode(path.read_bytes()).decode()+') format("truetype");}'
        for path,weight in [(regular,'400'),(bold,'600')]) + '</style>'

def wrap(text, width, size=12, bold=False):
    font = BOLD if bold else FONT
    result=[]
    for paragraph in str(text).split('\n'):
        line=''
        for word in paragraph.split():
            test = (line+' '+word).strip()
            if pdfmetrics.stringWidth(test,font,size)>width and line:
                result.append(line);line=word
            else:line=test
        result.append(line)
    return result

class Page:
    def __init__(self, pdf, bookmark, title):
        self.c=pdf;self.svg=[];self.cells=[];self.counter=0;self.boxes=[];self.text_boxes=[];self.edge_label_centers=[]
        self.bookmark=bookmark;self.title=title
        self.rect(0,0,W,H,COLORS['cream'],None)
        pdf.bookmarkPage(bookmark)

    def rect(self,x,y,w,h,fill,stroke=COLORS['line'],radius=0):
        c=self.c;c.setFillColor(fill);c.setLineWidth(.8)
        if stroke:c.setStrokeColor(stroke)
        if radius:c.roundRect(x,H-y-h,w,h,radius,stroke=bool(stroke),fill=1)
        else:c.rect(x,H-y-h,w,h,stroke=bool(stroke),fill=1)
        self.svg.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{radius}" fill="{fill}" stroke="{stroke or "none"}"/>')

    def text(self,x,y,lines,size=12,bold=False,color=None,align='left',leading=None):
        if isinstance(lines,str):lines=[lines]
        c=self.c;color=color or COLORS['ink'];c.setFillColor(color);c.setFont(BOLD if bold else FONT,size)
        leading=leading or size*1.35
        for i,line in enumerate(lines):
            yy=y+i*leading
            if align=='center':c.drawCentredString(x,H-yy,line)
            elif align=='right':c.drawRightString(x,H-yy,line)
            else:c.drawString(x,H-yy,line)
            anchor={'left':'start','center':'middle','right':'end'}[align]
            self.svg.append(f'<text x="{x:.2f}" y="{yy:.2f}" font-family="Montserrat,Arial,sans-serif" font-weight="{600 if bold else 400}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{html.escape(line)}</text>')

    def path(self,points,color=None,arrow=False,dash=False):
        c=self.c;color=color or COLORS['muted'];c.setStrokeColor(color);c.setFillColor(color);c.setLineWidth(1.2)
        if dash:c.setDash(4,3)
        p=c.beginPath();p.moveTo(points[0][0],H-points[0][1])
        for x,y in points[1:]:p.lineTo(x,H-y)
        c.drawPath(p);c.setDash()
        d='M '+' L '.join(f'{x:.2f},{y:.2f}' for x,y in points)
        self.svg.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.2" {"stroke-dasharray="+chr(34)+"4 3"+chr(34) if dash else ""}/>')
        if arrow:
            a,b=points[-2:];angle=math.atan2(b[1]-a[1],b[0]-a[0]);size=5
            tri=[b,(b[0]-size*math.cos(angle-.55),b[1]-size*math.sin(angle-.55)),(b[0]-size*math.cos(angle+.55),b[1]-size*math.sin(angle+.55))]
            p=c.beginPath();p.moveTo(tri[0][0],H-tri[0][1])
            for x,y in tri[1:]:p.lineTo(x,H-y)
            p.close();c.drawPath(p,fill=1,stroke=0)
            self.svg.append('<polygon points="'+' '.join(f'{x:.2f},{y:.2f}' for x,y in tri)+f'" fill="{color}"/>')

    def cell(self,id,label,x,y,w,h,kind='process',fill=None,stroke=None,link=None):
        self.counter+=1
        if link:self.svg.append('<a href="'+PDF_LINKS[link].replace('.pdf','.svg')+'">')
        fill=fill or COLORS['white'];stroke=stroke or COLORS['line']
        fontcolor=COLORS['ink']
        if kind=='start':fill=COLORS['maroon'];stroke=fill;fontcolor=COLORS['white']
        if kind=='end':fill=COLORS['greensoft'];stroke=COLORS['green'];fontcolor=COLORS['green']
        if kind=='stop':fill=COLORS['redsoft'];stroke=COLORS['red'];fontcolor=COLORS['red']
        if kind=='decision':fill=COLORS['ambersoft'];stroke=COLORS['amber']
        if kind=='subprocess':fill=COLORS['bluesoft'];stroke=COLORS['blue'];fontcolor=COLORS['blue']
        if kind=='decision':
            p=self.c.beginPath();pts=[(x+w/2,y),(x+w,y+h/2),(x+w/2,y+h),(x,y+h/2)]
            p.moveTo(pts[0][0],H-pts[0][1])
            for xx,yy in pts[1:]:p.lineTo(xx,H-yy)
            p.close();self.c.setFillColor(fill);self.c.setStrokeColor(stroke);self.c.drawPath(p,stroke=1,fill=1)
            self.svg.append('<polygon points="'+' '.join(f'{xx:.2f},{yy:.2f}' for xx,yy in pts)+f'" fill="{fill}" stroke="{stroke}"/>')
        else:self.rect(x,y,w,h,fill,stroke,24 if kind in ['start','end','stop'] else 6)
        lines=wrap(label,w*(.66 if kind=='decision' else 1)-16,12,bold=True)
        assert len(lines)<=5,(self.bookmark,id,label,lines)
        leading=14.5;ty=y+h/2-(len(lines)-1)*leading/2+4
        if kind=='decision':assert len(lines)<=3,(self.bookmark,id,lines)
        self.text(x+w/2,ty,lines,12,True,fontcolor,'center',leading)
        if kind=='subprocess':
            self.path([(x+5,y+10),(x+5,y+h-10)],COLORS['blue']);self.path([(x+w-5,y+10),(x+w-5,y+h-10)],COLORS['blue'])
        style='rhombus;' if kind=='decision' else 'rounded=1;arcSize=15;'
        if kind in ['start','end','stop']:style='rounded=1;arcSize=50;'
        self.cells.append(dict(id=id,label=label,x=x,y=y,w=w,h=h,kind=kind,style=style,fill=fill,stroke=stroke,color=fontcolor,link=link))
        self.boxes.append((id,x,y,w,h))
        if link:
            rect=(x,H-y-h,x+w,H-y)
            if getattr(self.c,'standalone',False):self.c.linkURL(PDF_LINKS[link],rect,relative=1,thickness=0)
            else:self.c.linkAbsolute('See '+link,link,Rect=rect,thickness=0)
            self.svg.append('</a>')

    def edge(self,id,source,target,points,label=''):
        self.path(points,arrow=True)
        if label:
            # Label the first horizontal segment; vertical branches label beside the line.
            vertical=next(((a,b) for a,b in zip(points,points[1:]) if a[0]==b[0] and abs(a[1]-b[1])>0),None)
            horizontal=next(((a,b) for a,b in zip(points,points[1:]) if a[1]==b[1] and abs(a[0]-b[0])>30),None)
            if vertical and not id.startswith('retry'):
                a,b=vertical;xx=a[0]+5;yy=(a[1]+b[1])/2+4
            elif horizontal:
                a,b=horizontal;xx=(a[0]+b[0])/2;yy=a[1]-5
            else:xx=points[0][0]+4;yy=points[0][1]-9
            tw=pdfmetrics.stringWidth(label,FONT,12)+8
            self.rect(xx-tw/2,yy-11,tw,16,COLORS['cream'],None)
            self.text(xx,yy,label,12,color=COLORS['muted'],align='center')
            self.edge_label_centers.append((id,xx,yy-4))
        self.cells.append(dict(id=id,source=source,target=target,points=points,label=label))

    def chrome(self,flow,index,part,total,commit):
        self.text(36,38,'UCN-FMRC  /  PROCESS LIBRARY',11,True,COLORS['maroon'])
        self.text(W-36,38,flow['id']+('  |  '+str(part)+' / '+str(total) if total>1 else ''),12,True,COLORS['maroon'],'right')
        self.text(36,76,flow['title'],23,True)
        desc=wrap(flow['purpose'],W-72,12)
        self.text(36,101,desc,12,color=COLORS['muted'])
        self.path([(36,126),(W-36,126)],COLORS['line'])
        self.text(36,151,'START  '+flow['trigger'],11,color=COLORS['muted'])
        self.path([(36,H-45),(W-36,H-45)],COLORS['line'])
        self.text(36,H-24,'Separate workflow  |  Read left to right  |  Source '+commit[:8],10,color=COLORS['muted'])
        self.text(W-36,H-24,'15 NOV 2026   /   '+flow['id'],10,color=COLORS['muted'],align='right')

    def finish(self,filename,description):
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.2f}pt" height="{H:.2f}pt" viewBox="0 0 {W:.2f} {H:.2f}" role="img" aria-labelledby="title desc"><title id="title">{html.escape(self.title)}</title><desc id="desc">{html.escape(description)}</desc>'+SVG_FONTS+''.join(self.svg)+'</svg>'
        (OUT/'svg'/filename).with_suffix('.svg').write_text(svg,encoding='utf-8')
        for i,a in enumerate(self.boxes):
            for b in self.boxes[i+1:]:
                _,ax,ay,aw,ah=a;_,bx,by,bw,bh=b
                assert ax+aw<=bx+.1 or bx+bw<=ax+.1 or ay+ah<=by+.1 or by+bh<=ay+.1,('Overlap',self.bookmark,a,b)
        for edge in (n for n in self.cells if 'source' in n):
            for id,x,y,w,h in self.boxes:
                if id in [edge['source'],edge['target']]:continue
                for a,b in zip(edge['points'],edge['points'][1:]):
                    hit=(a[0]==b[0] and x+.5<a[0]<x+w-.5 and max(min(a[1],b[1]),y+.5)<min(max(a[1],b[1]),y+h-.5)) or (a[1]==b[1] and y+.5<a[1]<y+h-.5 and max(min(a[0],b[0]),x+.5)<min(max(a[0],b[0]),x+w-.5))
                    assert not hit,('Connector through unrelated node',self.bookmark,edge['id'],id)
        for edge_id,cx,cy in self.edge_label_centers:
            for node in (n for n in self.cells if n.get('kind') in ['start','end','stop','process','decision','subprocess']):
                nx,ny,nw,nh=(node[k] for k in ['x','y','w','h'])
                inside=nx<cx<nx+nw and ny<cy<ny+nh
                if node['kind']=='decision':inside=abs(cx-nx-nw/2)/(nw/2)+abs(cy-ny-nh/2)/(nh/2)<.98
                assert not inside,('Edge label hidden by node',self.bookmark,edge_id,node['id'])
        return self.cells

def layout(flow):
    lanes=flow['lanes'];main=flow['steps'];n=len(main);assert n<=8,(flow['id'],n)
    lane_top=190;lane_height=416/len(lanes)
    cell=(W-198)/n;node_w=min(144,cell-18);height=82
    nodes={}
    for i,s in enumerate(main):
        lane=lanes.index(s['lane']);x=162+i*cell+(cell-node_w)/2;y=lane_top+lane_height*(lane+.5)-height/2
        nodes[s['id']]={**s,'x':x,'y':y,'w':node_w,'h':height,'col':i}
    for branch in flow.get('branches',[]):
        src=nodes[branch['from']];lane=lanes.index(branch['lane']);y=lane_top+lane_height*(lane+.5)-height/2
        col=branch.get('col',src['col']);x=162+col*cell+(cell-node_w)/2
        node={**branch,'x':x,'y':y,'w':node_w,'h':height,'col':col}
        assert lane!=lanes.index(src['lane']) or col!=src['col'],('Branch needs a separate position',flow['id'],branch)
        nodes[branch['id']]=node
    return nodes,lane_top,lane_height

def draw_flow(pdf,flow,index,commit):
    if flow['id']=='F00':return draw_overview(pdf,flow,commit)
    p=Page(pdf,flow['id'],flow['title']);p.chrome(flow,index,1,1,commit)
    nodes,top,lh=layout(flow)
    for i,lane in enumerate(flow['lanes']):
        p.rect(36,top+i*lh,W-72,lh,COLORS['white'] if i%2==0 else '#F7F5F2')
        p.rect(36,top+i*lh,118,lh,COLORS['soft'] if lane in ['Admin','Admin / Staff','Staff'] else COLORS['bluesoft'])
        p.text(49,top+i*lh+lh/2-5,wrap(lane,92,12,True),12,True,COLORS['maroon'] if lane in ['Admin','Admin / Staff','Staff'] else COLORS['blue'])
    # Connections are drawn before nodes, so the nodes mask any connector underneath.
    steps=flow['steps']
    for i,(a,b) in enumerate(zip(steps,steps[1:])):
        a,b=nodes[a['id']],nodes[b['id']];start=(a['x']+a['w'],a['y']+41);end=(b['x'],b['y']+41);mid=(start[0]+end[0])/2
        points=[start,(mid,start[1]),(mid,end[1]),end]
        p.edge('edge'+str(i),a['id'],b['id'],points,a.get('next',''))
    for i,e in enumerate(flow.get('shortcuts',[])):
        a,b=nodes[e['from']],nodes[e['to']]
        start=(a['x']+a['w'],a['y']+a['h']/2);end=(b['x'],b['y']+b['h']/2)
        mid=(start[0]+end[0])/2
        p.edge('shortcut'+str(i),a['id'],b['id'],[start,(mid,start[1]),(mid,end[1]),end],e['condition'])
    for i,b in enumerate(flow.get('branches',[])):
        a=nodes[b['from']];n=nodes[b['id']];down=n['y']>a['y'];x=a['x']+a['w']/2
        if n['col']!=a['col']:
            points=[(a['x']+a['w'],a['y']+41),(n['x'],n['y']+41)]
        else:points=[(x,a['y']+a['h'] if down else a['y']),(x,n['y'] if down else n['y']+n['h'])]
        p.edge('branch'+str(i),a['id'],n['id'],points,b['condition'])
        if b.get('retry'):
            target=nodes[b['retry']];sx=n['x']-7;tx=target['x']-7
            points=[(n['x'],n['y']+41),(sx,n['y']+41),(sx,172),(tx,172),(tx,target['y']+41),(target['x'],target['y']+41)]
            p.edge('retry'+str(i),n['id'],target['id'],points,'Retry')
    for node in nodes.values():
        assert node['x']>=154 and node['x']+node['w']<=W-36,(flow['id'],'Node outside lane',node['id'])
        p.cell(node['id'],node['label'],node['x'],node['y'],node['w'],node['h'],node.get('kind','process'),link=node.get('link'))
    p.text(36,642,'KEY RULES',11,True,COLORS['maroon'])
    y=664
    for rule in flow['rules'][:3]:
        lines=wrap('- '+rule,W-72,12);p.text(36,y,lines,12);y+=len(lines)*16+5
    assert y<767,(flow['id'],'rules too long',y)
    p.text(36,786,'CONNECTED FLOWS',10,color=COLORS['blue'])
    x=36+pdfmetrics.stringWidth('CONNECTED FLOWS',FONT,10)+20
    for i,fid in enumerate(flow.get('related',[]) or ['F00']):
        p.svg.append('<a href="'+PDF_LINKS[fid].replace('.pdf','.svg')+'">')
        p.text(x,786,fid,10,True,COLORS['blue']);p.svg.append('</a>')
        rect=(x-2,H-790,x+30,H-772)
        if getattr(pdf,'standalone',False):pdf.linkURL(PDF_LINKS[fid],rect,relative=1,thickness=0)
        else:pdf.linkAbsolute('See '+fid,fid,Rect=rect,thickness=0)
        p.cells.append(dict(id='ref'+str(i),label=fid,x=x-2,y=772,w=32,h=18,kind='decoration',style='text;',fill='none',stroke='none',color=COLORS['blue'],link=fid,size=10,align='left'))
        x+=44
    long=flow['purpose']+' Steps: '+' '.join(f'{i+1}. {s["lane"]}: {s["label"]}.' for i,s in enumerate(steps))+' Alternatives: '+' '.join(b['condition']+': '+b['label']+'.' for b in flow.get('branches',[]))
    return p.finish(flow['id']+'-'+flow['slug'],long)

def draw_overview(pdf,flow,commit):
    """An index of independent journeys, deliberately without sequencing arrows."""
    p=Page(pdf,flow['id'],flow['title']);p.chrome(flow,0,1,1,commit)
    labels=flow['groups']
    map_width=(W-112)/3
    for i,(name,ids,desc,link) in enumerate(labels):
        x=36+(i%3)*(map_width+20);y=195+(i//3)*190
        p.cell('map'+str(i),name+'\n'+ids,x,y,map_width,148,'subprocess',link=link)
        p.text(x+18,y+122,wrap(desc,map_width-36,12),12,color=COLORS['muted'])
    p.text(36,626,'CHOOSE A WORKFLOW',12,True,COLORS['maroon'])
    p.text(36,654,['The groups above are independent entry points. They do not form one mandatory sequence.',
                   'Use the linked PDF index or editable draw.io pages to open the exact process you need.',
                   'F09 and F10 are separate appointment journeys; online and face-to-face are meeting methods.'],12,leading=24)
    return p.finish(flow['id']+'-'+flow['slug'],flow['purpose'])

def write_drawio(filename,pages):
    file=ET.Element('mxfile',host='app.diagrams.net',type='device',version='26.0.0')
    for name,title,cells in pages:
        diagram=ET.SubElement(file,'diagram',id=name,name=name+' '+title)
        model=ET.SubElement(diagram,'mxGraphModel',dx='1191',dy='842',grid='0',page='1',pageScale='1',pageWidth=str(round(W)),pageHeight=str(round(H)))
        root=ET.SubElement(model,'root');ET.SubElement(root,'mxCell',id='0');ET.SubElement(root,'mxCell',id='1',parent='0')
        for n in cells:
            if 'source' in n:
                c=ET.SubElement(root,'mxCell',id=n['id'],value=n['label'],style='edgeStyle=none;html=0;endArrow=block;endFill=1;strokeColor=#626B78;fontSize=12;fontFamily=Montserrat;',edge='1',parent='1',source=n['source'],target=n['target'])
                geo=ET.SubElement(c,'mxGeometry',relative='1',**{'as':'geometry'});arr=ET.SubElement(geo,'Array',**{'as':'points'})
                for x,y in n['points'][1:-1]:ET.SubElement(arr,'mxPoint',x=str(x),y=str(y))
            else:
                style=n['style']+f'html=0;whiteSpace=wrap;fillColor={n["fill"]};strokeColor={n["stroke"]};fontColor={n["color"]};fontFamily=Montserrat;fontSize={n.get("size",12)};fontStyle=1;align={n.get("align","center")};verticalAlign=middle;spacing=8;'
                c=ET.SubElement(root,'mxCell',id=n['id'],value=n['label'],style=style,vertex='1',parent='1')
                if n.get('link'):c.set('link',('data:page/id,'+n['link']) if len(pages)>1 else n['link']+'.drawio')
                ET.SubElement(c,'mxGeometry',x=str(n['x']),y=str(n['y']),width=str(n['w']),height=str(n['h']),**{'as':'geometry'})
    ET.indent(file);ET.ElementTree(file).write(filename,encoding='utf-8',xml_declaration=True)

def decorate_drawio(flow,cells):
    # Add page title, role-lane backgrounds and footer to the same editable source.
    if flow['id']=='F00':top,lh=190,0
    else:_,top,lh=layout(flow)
    decor=[]
    def text(id,label,x,y,w,h,size=12,color='#273142',fill='none',style='text;'):
        decor.append(dict(id=id,label=label,x=x,y=y,w=w,h=h,kind='decoration',style=style,fill=fill,stroke='none',color=color,size=size,align='left'))
    text('title',flow['id']+'  |  '+flow['title'],36,42,W-72,54,23,COLORS['maroon'])
    text('purpose',flow['purpose'],36,95,W-72,40)
    for i,lane in enumerate(flow['lanes'] if flow['id']!='F00' else []):
        text('lane'+str(i),'',36,top+i*lh,W-72,lh,fill=COLORS['white'] if i%2==0 else '#F7F5F2',style='rounded=0;')
        text('lanehead'+str(i),lane,36,top+i*lh,118,lh,color=COLORS['maroon'],fill=COLORS['soft'],style='rounded=0;')
    if flow['id']=='F00':
        for i,(_,_,desc,_) in enumerate(flow['groups']):
            text('mapdesc'+str(i),desc,54+(i%3)*((W-112)/3+20),304+(i//3)*190,(W-112)/3-36,48)
    else:text('ref-label','CONNECTED FLOWS',36,772,125,18,10,COLORS['blue'])
    text('rules','KEY RULES\n'+'\n'.join(flow['rules']),36,638,W-72,118)
    return decor+cells

def text_page(pdf,title,sections,bookmark):
    p=Page(pdf,bookmark,title);p.text(36,42,'UCN-FMRC  /  WORKFLOW REFERENCE',11,True,COLORS['maroon']);p.text(36,85,title,25,True)
    y=128
    for heading,body in sections:
        p.text(36,y,heading,14,True,COLORS['maroon']);y+=26
        lines=wrap(body,W-90,12);p.text(36,y,lines,12);y+=len(lines)*17+24
    assert y<H-35,(title,y)
    pdf.showPage()

def generate():
    init_fonts();catalog=json.loads((HERE/'workflows.json').read_text(encoding='utf-8'));flows=catalog['workflows'];commit=catalog['source_commit']
    overview=catalog['overview'];allflows=[overview]+flows
    PDF_LINKS.update({f['id']:f['id']+'-'+f['slug']+'.pdf' for f in allflows})
    # Fail before rendering if an evidence anchor, graph target or permission lane is missing.
    for flow in allflows:
        for source in flow['sources']:
            file,sep,symbol=source.partition('::');source_path=ROOT/file
            assert source_path.is_file(),source
            if sep:assert re.search(r'(?:function\s+|class\s+|const\s+)'+re.escape(symbol)+r'\b',source_path.read_text(encoding='utf-8')),source
        for step in flow['steps']:
            assert step['lane'] in flow['lanes']
            if step.get('link'):assert step['link'] in PDF_LINKS
    for directory in [OUT/'svg',OUT/'png',OUT/'drawio',PDF,QA]:directory.mkdir(parents=True,exist_ok=True)
    booklet=PDF/'UCN-FMRC-Complete-Workflow-Booklet.pdf';c=canvas.Canvas(str(booklet),pagesize=(W,H),pageCompression=1)
    c.setTitle('UCN-FMRC Complete System Workflow Library');c.setAuthor('UCN-FMRC workflow documentation');c.setSubject('Source-grounded process diagrams for defense and training')
    text_page(c,'UCN-FMRC System Workflow Library',[
        ('45 separate workflows. One consistent visual language.','Customer, Admin and Staff journeys, from account access and appointments to products, payments, fulfillment and administration.'),
        ('Designed for defense and training','A3 landscape | Editable draw.io sources | Vector SVG and PDF | Individual 300 dpi PNG exports'),
        ('How to use this pack','Start with F00 for the system map. Open an individual workflow to follow the responsible actor in each lane. Decision labels explain alternatives. Blue subprocess boxes point to another numbered workflow.'),
        ('Evidence, not live-provider certification','Based on source commit '+commit+'. Reviewed 15 November 2026, Asia/Manila. Provider availability depends on actual server configuration. No production credentials, customer data, charges or refunds were used.'),
        ('Companion reference','The numbered step-by-step guide and source register are included as Markdown files in the pack. Every flow has its own editable and exported files.')], 'cover')
    c.addOutlineEntry('Cover','cover',0)
    for start in [0,23]:
        subset=flows[start:start+23];p=Page(c,'contents'+str(start),'Contents');p.text(36,42,'UCN-FMRC / SEPARATE WORKFLOW INDEX',11,True,COLORS['maroon']);p.text(36,82,'Workflow index'+(' - continued' if start else ''),25,True)
        y=119
        for flow in subset:
            p.text(36,y,flow['id'],12,True,COLORS['maroon']);p.text(93,y,flow['title'],12)
            c.linkAbsolute(flow['title'],flow['id'],Rect=(36,H-y-5,W-36,H-y+14),thickness=0);y+=28
        c.showPage()
    text_page(c,'Reading the diagrams',[
        ('Roles and responsibility','Each horizontal lane identifies who acts: Customer/Guest, Admin/Staff, System or an External Provider. Admin and Staff have separate lanes where permissions differ. Empty lanes preserve the ownership of a decision or exception.'),
        ('Shape legend','Maroon rounded box: start. White box: action. Gold diamond: decision. Green rounded box: successful outcome. Red rounded box: stopped, declined or correction required. Blue double-line box: linked workflow. Labelled arrows show direction and branch conditions.'),
        ('Waiting and exceptions','An offered quotation, pending payment or submitted refund is not a completed outcome. Read the key rules below each diagram. Retry arrows return to a specific earlier step; blue references open the detailed continuation flow.'),
        ('Boundaries','The diagrams document the implemented process, not an approval to operate a payment or courier integration. Server guards take precedence over frontend wording. Legacy records are explained in the technical reference, not shown as default new transactions.'),
        ('Accessibility','All diagrams have searchable text. Individual SVGs include a title and long description. STEP_BY_STEP.md provides a textual equivalent of every action, decision and alternative. Color is reinforced by shape and wording.')], 'legend')
    c.addOutlineEntry('Legend and reading guide','legend',0)
    pages=[]
    items=draw_flow(c,overview,0,commit);c.addOutlineEntry('F00 System overview','F00',0);c.showPage();pages.append(('F00',overview['title'],decorate_drawio(overview,items)))
    for i,flow in enumerate(flows):
        items=draw_flow(c,flow,i+1,commit);c.addOutlineEntry(flow['id']+' '+flow['title'],flow['id'],0);c.showPage()
        pages.append((flow['id'],flow['title'],decorate_drawio(flow,items)))
    text_page(c,'Source and compatibility notes',[
        ('Code is the documented baseline','The evidence register maps every workflow to existing backend methods, frontend modules and test files. Financial and permission branches were checked against server guards, not inferred from button text.'),
        ('Configured features','Google sign-in, CAPTCHA, email delivery, custom-product intake, online checkout, push notifications and courier tracking depend on installed storage and configuration. The pack does not certify that production credentials or provider activation are available.'),
        ('Current payment and fulfillment model','Normal product requests require FMRC review before payment. Starting preparation is a separate action. Custom products use accepted quotations and full online or advance cash payment. Pickup completion belongs to FMRC; eligible J&T delivery completion uses verified 17TRACK events.'),
        ('Legacy and unresolved cases','Legacy COD/manual-payment and older courier integrations may remain in compatibility code. They are not offered here as the default new-order path. Returns have refund, replacement and repair vocabulary; recording a resolution alone does not establish an automated replacement/repair fulfillment lifecycle.'),
        ('Separate documentation only','No website routes, business rules, permissions or database schema were changed. Existing workflow tests are evidence of local behavior, not proof of a live payment, email or courier delivery.')], 'technical')
    c.addOutlineEntry('Technical and compatibility reference','technical',0);c.save()
    # One PDF per flow, preserving vector text. Cross-flow links use named URLs
    # rather than undefined destinations in standalone files.
    for flow in [overview]+flows:
        filename=flow['id']+'-'+flow['slug'];single=canvas.Canvas(str(PDF/(filename+'.pdf')),pagesize=(W,H),pageCompression=1)
        single.standalone=True
        single.setTitle(flow['id']+' '+flow['title']);draw_flow(single,flow,0,commit);single.save()
    for name,title,cells in pages:write_drawio(OUT/'drawio'/(name+'.drawio'),[(name,title,cells)])
    write_drawio(OUT/'UCN-FMRC-Editable-Workflow-Library.drawio',pages)
    guide=['# UCN-FMRC: step-by-step workflow guide','',f'Source commit: `{commit}`. Reviewed 15 November 2026.','']
    register=['# Workflow source register','',f'Baseline: `{commit}`. All references are repository-relative; method names are evidence anchors.','']
    validation=[]
    for flow in [overview]+flows:
        stem=flow['id']+'-'+flow['slug']
        guide += ['## '+flow['id']+' - '+flow['title'],'',flow['purpose'],'',
                  f'[PDF](pdf/{stem}.pdf) | [Editable](drawio/{flow["id"]}.drawio) | [SVG](svg/{stem}.svg) | [PNG](png/{stem}.png)',
                  '','**Start:** '+flow['trigger'],'']
        if flow['id']=='F00':
            guide+=['This is a navigation map. Its groups are independent entry points, not sequential actions.','']
        for i,step in enumerate(flow['steps'] if flow['id']!='F00' else []):
            guide.append(f'{i+1}. **{step["lane"]}:** {step["label"].replace(chr(10)," - ")}.')
            if step.get('kind')=='decision':
                guide.append('   Primary route: '+step.get('next','Continue')+'. See the alternative below before proceeding.')
        if flow['id']=='F00':
            guide += ['- **'+name+' ('+ids+'):** '+desc+'. Open '+link+'.' for name,ids,desc,link in flow['groups']]
        guide+=['','**Alternatives and exceptions**','']
        for branch in flow.get('branches',[]):guide.append('- At step '+branch['from'][1:]+', **'+branch['condition']+'**: '+branch['label']+('. Return to step '+branch['retry'][1:] if branch.get('retry') else '. Stop this route')+'.')
        for shortcut in flow.get('shortcuts',[]):guide.append('- At step '+shortcut['from'][1:]+', **'+shortcut['condition']+'**: continue directly to step '+shortcut['to'][1:]+', skipping the intervening primary-route steps.')
        guide+=['','**Key rules**','']+['- '+rule for rule in flow['rules']]+['','**Related workflows:** '+', '.join(flow.get('related',[])), '']
        register += ['## '+flow['id']+' - '+flow['title'],'']
        for source in flow['sources']:
            file,sep,symbol=source.partition('::');p=ROOT/file;assert p.is_file(),source
            content=p.read_text(encoding='utf-8');line=1
            if symbol:
                match=re.search(r'(?:function\s+|class\s+|const\s+)'+re.escape(symbol)+r'\b',content)
                assert match,('Missing source anchor',source)
                line=content[:match.start()].count('\n')+1
            register.append(f'- `{file}:{line}`'+(' - `'+symbol+'`' if sep else ''))
        ids={n['id'] for n in flow['steps']}|{b['id'] for b in flow.get('branches',[])}
        for branch in flow.get('branches',[]):assert branch['from'] in ids and (not branch.get('retry') or branch['retry'] in ids)
        for step in flow['steps']:
            if step.get('kind')=='decision':assert any(b['from']==step['id'] for b in flow.get('branches',[])+flow.get('shortcuts',[])),('Unlabelled decision',flow['id'],step)
        if not flow.get('map_only'):assert flow['steps'][0]['kind']=='start' and flow['steps'][-1]['kind']=='end'
        validation.append({'id':flow['id'],'nodes':len(ids),'sources':len(flow['sources']),'decision_branches':len(flow.get('branches',[]))})
        register.append('')
    (OUT/'STEP_BY_STEP.md').write_text('\n'.join(guide),encoding='utf-8')
    (OUT/'SOURCE_REGISTER.md').write_text('\n'.join(register),encoding='utf-8')
    (HERE/'SOURCE_REGISTER.md').write_text('\n'.join(register),encoding='utf-8')
    (OUT/'README.md').write_text('''# UCN-FMRC Workflow Pack

45 independent workflows plus a navigation overview (F00). No production records or credentials are included.

- Open `UCN-FMRC-Editable-Workflow-Library.drawio` in draw.io / diagrams.net for the linked 46-page editable library.
- Open `drawio/Fxx.drawio` for one editable flow. Shapes, labels, lanes and connectors are native vectors.
- `svg/`: self-contained SVGs with embedded Montserrat, accessible descriptions and sibling links.
- `png/`: A3 landscape exports at 300 dpi (4961 x 3509 pixels).
- `pdf/`: 46 individual vector PDFs and a combined 51-page bookmarked, searchable booklet.
- `STEP_BY_STEP.md`: text equivalent, alternative paths and rules.
- `SOURCE_REGISTER.md`: current code anchors. `source/`: canonical JSON, generator and licensed font files.
- `TECHNICAL_REFERENCE.md`: role boundaries, state safeguards and compatibility notes.
- `VERIFY_REPORT.json` and `SHA256SUMS.json`: local structural checks and file integrity.

Install the included Montserrat fonts to see the same type in the draw.io editor. PDFs and SVGs already embed them.
The combined PDF uses internal links; standalone PDFs use sibling PDF filenames, so keep those files together.

## Rebuild

Copy `source/` to `docs/workflows/` in the documented repository baseline. Run `python docs/workflows/generate.py`
using Python with ReportLab, Pillow and pypdf installed, plus Poppler's `pdftoppm` on PATH. The Codex bundled
runtime already includes these tools. This generator invokes no application API and makes no workflow mutations.

## Interpretation

The main route is a common successful route; use labelled alternatives and key rules for exceptions. "If needed"
actions are optional. Provider-dependent functionality is subject to real server configuration. These documents
are not proof of a live payment, email, refund or courier event. Future code changes require diagram review.

## Design references

- [draw.io swimlane guidance](https://www.drawio.com/docs/diagram-types/swimlane-diagrams/)
- [draw.io process mapping](https://www.drawio.com/docs/best-practice/process-map-flowchart/)
- [draw.io vector SVG export](https://www.drawio.com/docs/manual/export/export-to-svg/)
- [W3C complex-image text alternatives](https://www.w3.org/WAI/tutorials/images/complex/)

''',encoding='utf-8')
    # Rasterize only the final standalone PDFs, then inspect contact sheets.
    pdftoppm=shutil.which('pdftoppm')
    assert pdftoppm,'Poppler pdftoppm is required for PNG exports and QA'
    def raster(flow):
        stem=flow['id']+'-'+flow['slug'];subprocess.run([pdftoppm,'-f','1','-singlefile','-scale-to','4961','-png',str(PDF/(stem+'.pdf')),str(OUT/'png'/stem)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(raster,allflows))
    from PIL import Image,ImageOps,ImageDraw
    allflows=[overview]+flows
    for first in range(0,len(allflows),4):
        sheet=Image.new('RGB',(2382,1684),'#E9E7E2')
        for j,flow in enumerate(allflows[first:first+4]):
            stem=flow['id']+'-'+flow['slug'];im=Image.open(OUT/'png'/(stem+'.png'));im.thumbnail((1191,842));sheet.paste(im,((j%2)*1191,(j//2)*842))
        sheet.save(QA/f'review-{first//4+1:02}.png')
    reader=PdfReader(str(booklet));assert len(reader.pages)==51,len(reader.pages)
    for i,page in enumerate(reader.pages):assert len((page.extract_text() or '').strip())>50,('Missing text',i)
    for number in [1,2,3,4,51]:
        subprocess.run([pdftoppm,'-f',str(number),'-l',str(number),'-singlefile','-scale-to','1684','-png',str(booklet),str(QA/f'booklet-{number:02}')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    # Native editable cells and sibling/internal links must survive an XML round trip.
    for file in (OUT/'drawio').glob('*.drawio'):
        tree=ET.parse(file);nodes=tree.findall('.//mxCell');assert any(n.get('vertex')=='1' for n in nodes)
        assert len({n.get('id') for n in nodes})==len(nodes)
        for n in nodes:
            if n.get('edge')=='1':assert n.get('source') in {c.get('id') for c in nodes} and n.get('target') in {c.get('id') for c in nodes}
            if n.get('link'):assert (file.parent/n.get('link')).exists()
    (OUT/'validation.json').write_text(json.dumps({'source_commit':commit,'flows':validation,'booklet_pages':len(reader.pages),'all_sources_exist':True,'node_overlap_check':'passed','searchable_pdf_text':'passed','minimum_shape_label_pt':12},indent=2),encoding='utf-8')
    shutil.copytree(PDF,OUT/'pdf',dirs_exist_ok=True)
    shutil.copytree(HERE,OUT/'source',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(HERE/'TECHNICAL_REFERENCE.md',OUT/'TECHNICAL_REFERENCE.md')
    (OUT/'previews').mkdir(exist_ok=True)
    for fid in ['F09','F10','F13']:
        source=next((OUT/'png').glob(fid+'-*'));im=Image.open(source);im.thumbnail((1684,1191));im.save(OUT/'previews'/source.name)
    from verify import verify
    verify(OUT,catalog)
    zip_path=OUT.parent/'UCN-FMRC-Complete-Workflow-Pack.zip'
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(OUT.rglob('*')):
            if p.is_file():z.write(p,p.relative_to(OUT))
    print(json.dumps({'workflows':len(flows),'overview':1,'pdfs':len(list(PDF.glob('*.pdf'))),'booklet_pages':len(reader.pages),'zip':str(zip_path),'review_sheets':str(QA)},indent=2))

if __name__=='__main__':generate()
