from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.accounts.urls')),
    path('api/', include('apps.personnel.urls')),
    path('api/leaves/', include('apps.leaves.urls')),
    path('api/reimbursements/', include('apps.reimbursement.urls')),
    path('api/recruitment/', include('apps.recruitment.urls')),
    path('api/payroll/', include('apps.payroll.urls')),
    path('api/audit/', include('apps.audit.urls')),
]
