import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { summaryCards } from '@/constants/hris-mock-data';

export function SummaryCards() {
  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
      {summaryCards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className='text-2xl font-semibold tabular-nums'>{card.value}</CardTitle>
            <CardAction>
              <Badge variant='outline'>
                {card.trendUp ? (
                  <Icons.trendingUp className='size-3' />
                ) : (
                  <Icons.clock className='size-3' />
                )}
                {card.trend}
              </Badge>
            </CardAction>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
