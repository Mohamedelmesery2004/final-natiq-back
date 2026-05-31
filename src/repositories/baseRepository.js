class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    return await this.model.create(data);
  }

  async findById(id, select = '') {
    let query = this.model.findById(id);
    if (select) query = query.select(select);
    return await query.exec();
  }

  async findOne(filter, select = '') {
    let query = this.model.findOne(filter);
    if (select) query = query.select(select);
    return await query.exec();
  }

  async find(filter = {}, options = {}) {
    let query = this.model.find(filter);
    if (options.select) query = query.select(options.select);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.skip) query = query.skip(options.skip);
    if (options.populate) query = query.populate(options.populate);
    return await query.exec();
  }

  async findWithPagination(filter = {}, page = 1, limit = 10, options = {}) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.find(filter, { ...options, skip, limit }),
      this.count(filter),
    ]);
    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    };
  }

  async update(id, data, options = { new: true }) {
    return await this.model.findByIdAndUpdate(id, data, options).exec();
  }

  async updateMany(filter, data) {
    return await this.model.updateMany(filter, data).exec();
  }

  async delete(id) {
    return await this.model.findByIdAndDelete(id).exec();
  }

  async deleteMany(filter) {
    return await this.model.deleteMany(filter).exec();
  }

  async count(filter = {}) {
    return await this.model.countDocuments(filter).exec();
  }

  async aggregate(pipeline) {
    return await this.model.aggregate(pipeline).exec();
  }
}

export default BaseRepository;
