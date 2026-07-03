jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    eval: jest.fn().mockResolvedValue(1),
    get: jest.fn(),
    set: jest.fn(),
  }));
});
