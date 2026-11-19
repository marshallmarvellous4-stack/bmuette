import asyncio, pathlib
from playwright.async_api import async_playwright
here = pathlib.Path(__file__).parent
jobs = [('icon.svg','icon.png',1024,False),('adaptive-foreground.svg','adaptive-foreground.png',1024,True),
        ('adaptive-monochrome.svg','adaptive-monochrome.png',1024,True),('splash-icon.svg','splash-icon.png',1024,False),
        ('icon.svg','favicon.png',48,False),('icon.svg','icon-180.png',180,False)]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        for src, out, size, alpha in jobs:
            pg = await b.new_page(viewport={'width':size,'height':size})
            svg = (here/src).read_text()
            await pg.set_content(f'<body style="margin:0;background:transparent"><div style="width:{size}px;height:{size}px">{svg.replace(chr(34)+"1024"+chr(34), chr(34)+str(size)+chr(34))}</div>')
            await pg.screenshot(path=str(here/out), omit_background=alpha)
            await pg.close()
        await b.close()
asyncio.run(main())
