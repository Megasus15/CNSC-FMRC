import sys
import subprocess
import re
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path('tmp/auth-video-tools').resolve()))
import imageio_ffmpeg

exe = imageio_ffmpeg.get_ffmpeg_exe()
source = str(Path('images/Product showcase.mp4').resolve())
probe = subprocess.run([exe, '-hide_banner', '-i', source], capture_output=True, text=True).stderr
print(probe)
m = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', probe)
duration = int(m[1])*3600 + int(m[2])*60 + float(m[3])
folder = Path('tmp/auth-video-frames')
folder.mkdir(exist_ok=True)
sheet = Image.new('RGB', (1200, 1000), '#ffffff')
draw = ImageDraw.Draw(sheet)
for index in range(12):
    timestamp = max(0, min(duration-0.1, duration*index/12))
    path = folder / f'frame-{timestamp:.2f}.jpg'
    subprocess.run([exe, '-y', '-ss', str(timestamp), '-i', source, '-frames:v', '1', '-q:v', '2', str(path)], capture_output=True, check=True)
    image = Image.open(path)
    image.thumbnail((390, 210))
    x = (index%3)*400
    y = (index//3)*250
    sheet.paste(image, (x,y+25))
    draw.text((x+8,y+5), f'{timestamp:.2f}s | {Image.open(path).size}', fill='black')
    print(f'{timestamp:.2f}s {path}')
sheet.save(folder/'contact-sheet.jpg')
