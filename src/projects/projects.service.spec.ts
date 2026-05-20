import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { ProjectsService } from './projects.service';
import { Project } from './entities/project.entity';
import { UsersService } from '../users/users.service';
import { AuditLogService } from '../audit-log/audit-log.service';

const mockRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockUsersService = { findOne: jest.fn() };
const mockAuditLog = { log: jest.fn().mockResolvedValue(undefined) };

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: 1,
    name: 'Test Project',
    description: 'A test project',
    ownerId: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Project;

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: mockRepository },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    jest.clearAllMocks();
    mockAuditLog.log.mockResolvedValue(undefined);
  });

  describe('create()', () => {
    const dto = { name: 'My Project', description: 'Desc', ownerId: 1 };

    it('throws BadRequestException when owner does not exist', async () => {
      mockUsersService.findOne.mockRejectedValue(new NotFoundException());

      await expect(service.create(dto, 1)).rejects.toThrow(
        new BadRequestException('Owner user does not exist'),
      );
    });

    it('persists and returns a ProjectResponseDto when owner exists', async () => {
      mockUsersService.findOne.mockResolvedValue({ id: 1, username: 'jdoe' });
      const project = makeProject();
      mockRepository.create.mockReturnValue(project);
      mockRepository.save.mockResolvedValue(project);

      const result = await service.create(dto, 1);

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ id: 1, name: 'Test Project', ownerId: 1 });
      expect(result).not.toHaveProperty('deletedAt');
    });

    it('calls audit.log after successful create', async () => {
      mockUsersService.findOne.mockResolvedValue({ id: 1 });
      const project = makeProject({ id: 3 });
      mockRepository.create.mockReturnValue(project);
      mockRepository.save.mockResolvedValue(project);

      await service.create(dto, 7);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 7, resourceId: 3 }),
      );
    });
  });

  describe('findOne()', () => {
    it('throws NotFoundException for a soft-deleted project', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1, deletedAt: IsNull() },
      });
    });
  });

  describe('findAll()', () => {
    it('excludes soft-deleted projects', async () => {
      const active = makeProject({ id: 1, name: 'Active' });
      mockRepository.find.mockResolvedValue([active]);

      const result = await service.findAll();

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { deletedAt: IsNull() },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Active');
    });
  });

  describe('softDelete()', () => {
    it('sets deletedAt and saves', async () => {
      const project = makeProject({ deletedAt: null });
      mockRepository.findOne.mockResolvedValue(project);
      mockRepository.save.mockResolvedValue({ ...project, deletedAt: new Date() });

      await service.softDelete(1, 1);

      const saved = mockRepository.save.mock.calls[0][0] as Project;
      expect(saved.deletedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when called on an already-deleted project', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.softDelete(1, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findDeleted()', () => {
    it('returns only projects with a non-null deletedAt', async () => {
      const deleted = makeProject({ id: 2, deletedAt: new Date() });
      mockRepository.find.mockResolvedValue([deleted]);

      const result = await service.findDeleted();

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { deletedAt: Not(IsNull()) },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });
  });

  describe('restore()', () => {
    it('throws NotFoundException when no deleted project exists with that id', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.restore(99, 1)).rejects.toThrow(NotFoundException);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 99, deletedAt: Not(IsNull()) },
      });
    });

    it('clears deletedAt, saves, and calls audit log', async () => {
      const project = makeProject({ id: 5, deletedAt: new Date() });
      mockRepository.findOne.mockResolvedValue(project);
      mockRepository.save.mockResolvedValue({ ...project, deletedAt: null });

      await service.restore(5, 7);

      const saved = mockRepository.save.mock.calls[0][0] as Project;
      expect(saved.deletedAt).toBeNull();
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 7, resourceId: 5 }),
      );
    });
  });
});
