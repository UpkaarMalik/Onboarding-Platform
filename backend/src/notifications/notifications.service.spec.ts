import { NotificationsService } from './notifications.service';

describe('NotificationsService.notify', () => {
  const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const service = new NotificationsService({ query } as any);

  beforeEach(() => query.mockClear());

  it('inserts one row for the recipient, on the caller client when given', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await service.notify('user-a', 'document_approved', 'Your PAN Card was approved', null, '/start-here', {
      actorId: 'hr-1',
      client,
    });
    expect(query).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][1]).toEqual([
      'user-a', 'document_approved', 'Your PAN Card was approved', null, '/start-here',
    ]);
  });

  it('never notifies someone about their own action', async () => {
    await service.notify('user-a', 'task_blocked', 'x', null, '/start-here', { actorId: 'user-a' });
    expect(query).not.toHaveBeenCalled();
  });
});
