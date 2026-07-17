FactoryBot.define do
  factory :capability do
    association :agent
    capability_id { Faker::Internet.slug.gsub('-', '_') }
    name          { Faker::Job.title }
    description   { Faker::Lorem.sentence }
    pricing_model { 'per_request' }
    price_amount  { '0.05' }
    price_currency { 'USDC' }
    input_schema  { {} }
    output_schema { {} }
  end
end
