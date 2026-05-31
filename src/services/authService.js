import { userRepo, companyRepo } from '../repositories/index.js';
import { generateToken } from '../middlewares/authMiddleware.js';
import { ROLES } from '../constants/index.js';
import ApiError from '../utils/apiError.js';

class AuthService {
  async register({ companySlug, name, email, password, phone }) {
    const company = await companyRepo.findOne({ slug: companySlug, isActive: true });
    if (!company) {
      throw ApiError.notFound('Company not found or inactive');
    }

    const existingUser = await userRepo.findOne({ companyId: company._id, email });
    if (existingUser) {
      throw ApiError.conflict('User with this email already exists in this company');
    }

    const user = await userRepo.create({
      companyId: company._id,
      name,
      email,
      passwordHash: password,
      phone: phone || null,
      role: ROLES.CUSTOMER,
    });

    const token = generateToken(user);
    return { user: user.toJSON(), token };
  }

  async login({ email, password, companySlug }) {
    const company = await companyRepo.findOne({ slug: companySlug });
    if (!company) {
      throw ApiError.notFound('Company not found');
    }

    const user = await userRepo.findOne({ companyId: company._id, email });
    if (!user) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user);
    return { user: user.toJSON(), token };
  }

  async getMe(userId) {
    return await userRepo.model.findById(userId).populate('companyId', 'name slug');
  }

  async getPublicCompanies() {
    return await companyRepo.find({ isActive: true }, { select: 'name slug _id' });
  }
}

export default new AuthService();
