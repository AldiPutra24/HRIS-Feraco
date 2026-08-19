import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { freelanceEvents } from '@/constants/hris-mock-data';

export function FreelanceEventProgress() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Freelance Event Progress</CardTitle>
        <CardDescription>Progres event yang melibatkan freelancer.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='space-y-6'>
          {freelanceEvents.map((event) => (
            <div key={event.id} className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-sm font-medium'>{event.title}</p>
                  <p className='text-muted-foreground text-xs'>
                    {event.date} · {event.freelancers} freelancer
                  </p>
                </div>
                <span className='text-muted-foreground text-sm tabular-nums'>{event.progress}%</span>
              </div>
              <Progress value={event.progress} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
