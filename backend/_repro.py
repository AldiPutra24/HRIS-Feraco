import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.personnel.models import Employee
from apps.personnel.serializers import EmployeeReadSerializer

emp = Employee.objects.first()
print("EMP:", emp)
if emp is None:
    print("NO_EMPLOYEE")
else:
    try:
        s = EmployeeReadSerializer(emp, context={'request': None})
        d = s.data
        print("OK keys:", list(d.keys()))
        print("photo_url:", d.get("photo_url"))
    except Exception:
        import traceback
        traceback.print_exc()
