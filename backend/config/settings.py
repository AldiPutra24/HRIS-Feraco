"""Django settings for the HRIS backend."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env(path):
    """Load KEY=VALUE pairs from a .env file without overwriting the real env."""
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip())
    except FileNotFoundError:
        pass


_load_env(BASE_DIR.parent / '.env')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-insecure-change-me')
DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'
ALLOWED_HOSTS = [h for h in os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'django_filters',
    'apps.accounts',
    'apps.personnel',
    'apps.audit',
    'apps.leaves',
    'apps.reimbursement',
    'apps.recruitment',
    'apps.payroll',
    'apps.onboarding',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Environment: 'development' | 'production'. Controls defaults (storage bucket,
# security flags). The database backend is chosen explicitly by DB_ENGINE.
APP_ENV = os.environ.get('APP_ENV', 'development').lower()

# DB_ENGINE: 'sqlite' (tests/quick local) | 'postgresql' (local PostgreSQL) |
# 'supabase' (Supabase PostgreSQL). Defaults to supabase in production,
# postgresql otherwise.
_db = os.environ.get('DB_ENGINE', '').strip().lower() or (
    'supabase' if APP_ENV == 'production' else 'postgresql'
)
if _db == 'sqlite':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
elif _db == 'supabase':
    # Supabase PostgreSQL — credentials from server env vars only.
    _missing = [k for k in ('SUPABASE_DB_NAME', 'SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_HOST') if not os.environ.get(k)]
    if _missing:
        raise RuntimeError(f'Missing Supabase DB env vars: {", ".join(_missing)}')
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ['SUPABASE_DB_NAME'],
            'USER': os.environ['SUPABASE_DB_USER'],
            'PASSWORD': os.environ['SUPABASE_DB_PASSWORD'],
            'HOST': os.environ['SUPABASE_DB_HOST'],
            'PORT': os.environ.get('SUPABASE_DB_PORT', '5432'),
            'CONN_MAX_AGE': 60,
        }
    }
else:
    # Local PostgreSQL.
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('DB_NAME', os.environ.get('POSTGRES_DB', 'hris_dev')),
            'USER': os.environ.get('DB_USER', os.environ.get('POSTGRES_USER', 'postgres')),
            'PASSWORD': os.environ.get('DB_PASSWORD', os.environ.get('POSTGRES_PASSWORD', '')),
            'HOST': os.environ.get('DB_HOST', os.environ.get('POSTGRES_HOST', 'localhost')),
            'PORT': os.environ.get('DB_PORT', os.environ.get('POSTGRES_PORT', '5432')),
            'CONN_MAX_AGE': 60,
        }
    }

# Supabase — storage + auth metadata (service key is backend-only).
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SECRET_KEY = os.environ.get('SUPABASE_SECRET_KEY', '')
SUPABASE_STORAGE_BUCKET = os.environ.get(
    'SUPABASE_STORAGE_BUCKET',
    'employee-documents' if APP_ENV == 'production' else 'employee-documents-dev',
)
REIMBURSEMENT_STORAGE_BUCKET = os.environ.get(
    'REIMBURSEMENT_STORAGE_BUCKET',
    'reimbursement-documents' if APP_ENV == 'production' else 'reimbursement-documents-dev',
)
RECRUITMENT_STORAGE_BUCKET = os.environ.get(
    'RECRUITMENT_STORAGE_BUCKET',
    'recruitment-cvs' if APP_ENV == 'production' else 'recruitment-cvs-dev',
)
ONBOARDING_STORAGE_BUCKET = os.environ.get(
    'ONBOARDING_STORAGE_BUCKET',
    'onboarding-documents' if APP_ENV == 'production' else 'onboarding-documents-dev',
)

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Jakarta'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# DRF — session/cookie auth (secure server-side), JSON only.
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}

# CORS — cookie-based session auth requires explicit origins + credentials.
from corsheaders.defaults import default_headers  # noqa: E402

CORS_ALLOWED_ORIGINS = [
    o for o in (os.environ.get('CORS_ALLOWED_ORIGINS') or 'http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',') if o
]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = list(default_headers) + ['x-csrftoken']
CSRF_TRUSTED_ORIGINS = [
    o for o in (os.environ.get('CSRF_TRUSTED_ORIGINS') or 'http://localhost:3000,http://localhost:3001,http://localhost:3002').split(',') if o
]

SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False  # JS must read the token value for the X-CSRFToken header

# Production HTTPS behind a reverse proxy (nginx).
if APP_ENV == 'production':
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
