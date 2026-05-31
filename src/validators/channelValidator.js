import Joi from 'joi';

const telegramWebhook = {
  body: Joi.object({
    update_id: Joi.number(),
    message: Joi.object({
      message_id: Joi.number(),
      from: Joi.object({
        id: Joi.number().required(),
        first_name: Joi.string(),
        last_name: Joi.string(),
        username: Joi.string(),
      }).options({ stripUnknown: true, abortEarly: false }).required(),
      chat: Joi.object({
        id: Joi.number().required(),
        type: Joi.string(),
      }).required(),
      date: Joi.number(),
      text: Joi.string().required(),
    }).required(),
  }).unknown(true),
};

const whatsappMockWebhook = {
  body: Joi.object({
    companySlug: Joi.string().required().trim().lowercase(),
    entry: Joi.array()
      .items(
        Joi.object({
          changes: Joi.array().items(
            Joi.object({
              value: Joi.object({
                messages: Joi.array().items(
                  Joi.object({
                    from: Joi.string().required(),
                    type: Joi.string().default('text'),
                    text: Joi.object({
                      body: Joi.string().required(),
                    }).options({ stripUnknown: true, abortEarly: false }),
                    timestamp: Joi.string(),
                  })
                ).options({ stripUnknown: true }),
                contacts: Joi.array().items(
                  Joi.object({
                    profile: Joi.object({
                      name: Joi.string(),
                    }),
                    wa_id: Joi.string(),
                  })
                ),
              }),
            })
          ),
        })
      )
      .required(),
  }),
};

export { telegramWebhook, whatsappMockWebhook };
