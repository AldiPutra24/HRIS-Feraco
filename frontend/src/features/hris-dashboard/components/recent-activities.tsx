import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { recentActivities } from '@/constants/hris-mock-data';

export function RecentActivities() {
  return (
    <Card className='h-full'>
      <CardHeader>
        <CardTitle>Recent Activities</CardTitle>
        <CardDescription>Aktivitas terbaru di seluruh HRIS.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='space-y-6'>
          {recentActivities.map((activity) => {
            const initials = activity.name
              .split(' ')
              .map((part) => part[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();
            return (
              <div key={activity.id} className='flex items-center'>
                <Avatar className='h-9 w-9'>
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className='ml-4 space-y-1'>
                  <p className='text-sm leading-none font-medium'>{activity.name}</p>
                  <p className='text-muted-foreground text-sm'>{activity.action}</p>
                </div>
                <div className='text-muted-foreground ml-auto text-xs'>{activity.time}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
