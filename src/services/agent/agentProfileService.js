import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../../repositories/index.js';
import { User } from '../../models/index.js';
import ApiError from '../../utils/apiError.js';

class AgentProfileService {
  async updateAgentProfile(agentId, updateData) {
    const user = await userRepo.model.findById(agentId);
    if (!user) throw ApiError.notFound('User not found');

    if (updateData.name !== undefined) user.name = updateData.name;
    if (updateData.phone !== undefined) user.phone = updateData.phone;
    if (updateData.profileImage !== undefined) user.profileImage = updateData.profileImage;
    if (updateData.password) user.passwordHash = updateData.password; 

    await user.save();
    return user.toJSON();
  }
}

export default new AgentProfileService();
