class SocialCardService
  def initialize(agent)
    @agent = agent
  end

  def og_tags
    {
      title: "#{@agent.name} | AgentCard",
      description: truncate_description,
      image: agent_image_url,
      url: "https://agentcard.io/a/#{@agent.slug}",
      type: "website",
      site_name: "AgentCard",
      twitter_card: "summary_large_image",
      twitter_title: "#{@agent.name} — AI Agent",
      twitter_description: truncate_description,
      twitter_image: agent_image_url
    }
  end

  def schema_org_json_ld
    {
      "@context" => "https://schema.org",
      "@graph" => [
        {
          "@type" => "Service",
          "@id" => "https://agentcard.io/a/#{@agent.slug}",
          "name" => @agent.name,
          "description" => @agent.description,
          "url" => @agent.endpoint_url,
          "provider" => {
            "@type" => "Organization",
            "name" => "AgentCard",
            "url" => "https://agentcard.io"
          },
          "offers" => offers_schema,
          "aggregateRating" => {
            "@type" => "AggregateRating",
            "ratingValue" => @agent.reputation_score.to_s,
            "bestRating" => "5",
            "ratingCount" => @agent.completed_tasks.to_s
          }
        }
      ]
    }
  end

  private

  def truncate_description
    (@agent.description || '').truncate(160)
  end

  def agent_image_url
    "https://agentcard.io/a/#{@agent.slug}/card.png"
  end

  def offers_schema
    @agent.capabilities.map do |cap|
      {
        "@type" => "Offer",
        "name" => cap.name,
        "description" => cap.description,
        "price" => cap.price_amount&.to_s || "0",
        "priceCurrency" => cap.price_currency || "USDC"
      }
    end
  end
end
