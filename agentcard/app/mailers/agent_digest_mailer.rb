class AgentDigestMailer < ApplicationMailer
  def weekly_digest(user, top_agents)
    @user = user
    @top_agents = top_agents
    @unsubscribe_token = generate_unsubscribe_token(user)

    mail(
      to: user.email,
      subject: "Top AI Agents This Week | AgentCard",
      "List-Unsubscribe" => "<https://agentcard.io/unsubscribe/#{@unsubscribe_token}>",
      "List-Unsubscribe-Post" => "List-Unsubscribe=One-Click"
    )
  end

  private

  def generate_unsubscribe_token(user)
    JWT.encode(
      { user_id: user.id, exp: 30.days.from_now.to_i },
      Rails.application.secret_key_base,
      "HS256"
    )
  end
end
