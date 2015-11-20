import os.path

from flask_sslify import SSLify
from werkzeug.contrib.fixers import ProxyFix
from whitenoise import WhiteNoise

from app import app


SSLify(app, permanent=True)
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
wn_app = WhiteNoise(app.wsgi_app, root=os.path.join(APP_ROOT, 'static'), prefix='/static')
wn_app.add_files(root=os.path.join(APP_ROOT, 'root_files'), prefix='')
app.wsgi_app = wn_app

app.wsgi_app = ProxyFix(app.wsgi_app)
