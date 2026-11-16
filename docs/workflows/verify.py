"""Independent structural/export checks for the generated workflow pack."""
from pathlib import Path
import hashlib,json
from xml.etree import ElementTree as ET
from PIL import Image
from pypdf import PdfReader

def verify(pack, catalog):
    pack=Path(pack);flows=[catalog['overview']]+catalog['workflows'];ids={f['id'] for f in flows}
    assert len(catalog['workflows'])==45 and len(ids)==46
    assert len(list((pack/'drawio').glob('*.drawio')))==46
    assert len(list((pack/'svg').glob('*.svg')))==46
    assert len(list((pack/'png').glob('*.png')))==46
    assert len(list((pack/'pdf').glob('*.pdf')))==47
    master=ET.parse(pack/'UCN-FMRC-Editable-Workflow-Library.drawio')
    assert {p.get('id') for p in master.findall('diagram')}==ids
    native_shapes=native_edges=pdf_links=0
    for diagram in master.findall('diagram'):
        cells=diagram.findall('.//mxCell');cell_ids={n.get('id') for n in cells}
        assert len(cell_ids)==len(cells)
        for c in cells:
            if c.get('vertex')=='1':native_shapes+=1;assert 'image=' not in c.get('style','')
            if c.get('edge')=='1':native_edges+=1;assert c.get('source') in cell_ids and c.get('target') in cell_ids
            if c.get('link'):assert c.get('link').removeprefix('data:page/id,') in ids
    for f in flows:
        stem=f['id']+'-'+f['slug']
        svg=ET.parse(pack/'svg'/(stem+'.svg'));ns={'s':'http://www.w3.org/2000/svg'}
        assert svg.find('s:title',ns) is not None and svg.find('s:desc',ns) is not None
        assert not svg.findall('.//s:foreignObject',ns) and not svg.findall('.//s:image',ns)
        assert '@font-face' in svg.find('s:style',ns).text
        for a in svg.findall('.//s:a',ns):assert (pack/'svg'/a.get('href')).is_file()
        im=Image.open(pack/'png'/(stem+'.png'));assert im.size==(4961,3509),(stem,im.size)
        assert 299<im.info['dpi'][0]<301
        r=PdfReader(pack/'pdf'/(stem+'.pdf'));assert len(r.pages)==1
        assert f['title'] in r.pages[0].extract_text()
        assert abs(float(r.pages[0].mediabox.width)-1190.551)<.01
        for a in r.pages[0].get('/Annots',[]):
            a=a.get_object();action=a.get('/A')
            if action and action.get('/S')=='/URI':
                assert (pack/'pdf'/action['/URI']).is_file();pdf_links+=1
        ET.fromstring(ET.tostring(ET.parse(pack/'drawio'/(f['id']+'.drawio')).getroot()))
        if f.get('map_only'):continue
        nodes={s['id']:s for s in f['steps']};nodes.update({b['id']:b for b in f['branches']})
        assert len(nodes)==len(f['steps'])+len(f['branches'])
        connections={s['id']:[] for s in nodes.values()}
        for a,b in zip(f['steps'],f['steps'][1:]):connections[a['id']].append(b['id'])
        for b in f['branches']:
            connections[b['from']].append(b['id'])
            if b.get('retry'):connections[b['id']].append(b['retry'])
        for s in f.get('shortcuts',[]):connections[s['from']].append(s['to'])
        visited=set();todo=[f['steps'][0]['id']]
        while todo:
            n=todo.pop()
            if n in visited:continue
            visited.add(n);todo+=connections[n]
        assert visited==set(nodes),('Unreachable nodes',f['id'],set(nodes)-visited)
        for n,targets in connections.items():
            assert targets or nodes[n]['kind'] in ['end','stop'],('Dead end',f['id'],n)
            if nodes[n]['kind']=='decision':assert len(targets)>=2,(f['id'],n)
    combined=PdfReader(pack/'pdf/UCN-FMRC-Complete-Workflow-Booklet.pdf')
    assert len(combined.pages)==51 and len(combined.outline)==49
    for page in combined.pages:assert len(page.extract_text().strip())>50
    result=dict(workflows=45,overview=1,booklet_pages=51,individual_pdfs=46,
                editable_pages=46,native_shapes=native_shapes,native_connectors=native_edges,
                standalone_pdf_crosslinks=pdf_links,svg_font_embedding=True,png_dpi=300,
                graph_reachability='passed',diagram_xml_roundtrip='passed',
                pdf_text_and_bookmarks='passed',export_counts='passed',
                external_editor_import='Not performed: user chose local verification after automatic approval review blocked third-party transmission',
                production_workflow_mutations='None; documentation generation only',source_commit=catalog['source_commit'])
    (pack/'VERIFY_REPORT.json').write_text(json.dumps(result,indent=2))
    hashes={str(p.relative_to(pack)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(pack.rglob('*')) if p.is_file() and p.name!='SHA256SUMS.json'}
    (pack/'SHA256SUMS.json').write_text(json.dumps(hashes,indent=2))
    return result

if __name__=='__main__':
    root=Path(__file__).resolve().parents[2]
    print(json.dumps(verify(root/'output/workflow-diagrams',json.loads((root/'docs/workflows/workflows.json').read_text())),indent=2))
